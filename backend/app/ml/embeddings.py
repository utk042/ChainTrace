"""
ChainTrace Forensics — Node2Vec Graph Embeddings
Produces 64-dimensional node embeddings from the entity graph.
Uses PyTorch Geometric's Node2Vec implementation.
"""

import torch
import numpy as np
import networkx as nx
from pathlib import Path
from typing import Optional
from app.config import settings

# Try importing PyG; fall back gracefully
try:
    from torch_geometric.nn import Node2Vec as PyGNode2Vec
    from torch_geometric.utils import from_networkx
    PYG_AVAILABLE = True
except ImportError:
    PYG_AVAILABLE = False
    print("⚠ PyTorch Geometric not available. Using fallback embeddings.")


class GraphEmbedder:
    """
    Computes Node2Vec embeddings for all nodes in the entity graph.
    Falls back to spectral/random embeddings if PyG is not available.
    """

    def __init__(self, embedding_dim: int = None):
        self.embedding_dim = embedding_dim or settings.N2V_EMBEDDING_DIM
        self.embeddings: dict[str, np.ndarray] = {}
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def fit(self, G: nx.Graph) -> dict[str, np.ndarray]:
        """
        Train Node2Vec embeddings on the entity graph.

        Returns: {node_id: embedding_vector}
        """
        if G.number_of_nodes() == 0:
            return {}

        if PYG_AVAILABLE:
            try:
                return self._fit_pyg(G)
            except Exception as e:
                print(f"  PyG Node2Vec fallback: {e}")
                return self._fit_fallback(G)
        else:
            return self._fit_fallback(G)

    def _fit_pyg(self, G: nx.Graph) -> dict[str, np.ndarray]:
        """Train Node2Vec using PyTorch Geometric."""
        print("  Training Node2Vec embeddings (PyG)...")

        # Map node IDs to integers
        node_list = list(G.nodes())
        node_to_idx = {n: i for i, n in enumerate(node_list)}

        # Create edge index
        edges = list(G.edges())
        if not edges:
            self.embeddings = {n: np.zeros(self.embedding_dim) for n in node_list}
            return self.embeddings

        edge_index = torch.tensor(
            [[node_to_idx[u], node_to_idx[v]] for u, v in edges] +
            [[node_to_idx[v], node_to_idx[u]] for u, v in edges],  # undirected
            dtype=torch.long
        ).t().contiguous().to(self.device)

        # Create Node2Vec model
        model = PyGNode2Vec(
            edge_index,
            embedding_dim=self.embedding_dim,
            walk_length=settings.N2V_WALK_LENGTH,
            context_size=settings.N2V_CONTEXT_SIZE,
            walks_per_node=settings.N2V_WALKS_PER_NODE,
            num_negative_samples=1,
            p=1.0,
            q=1.0,
            sparse=True,
        ).to(self.device)

        optimizer = torch.optim.SparseAdam(model.parameters(), lr=settings.N2V_LEARNING_RATE)

        # Training loop
        model.train()
        for epoch in range(settings.N2V_EPOCHS):
            for subset in model.loader(batch_size=128, shuffle=True):
                optimizer.zero_grad()
                loss = model.loss(*[s.to(self.device) for s in subset])
                loss.backward()
                optimizer.step()

            if (epoch + 1) % 10 == 0:
                print(f"    Epoch {epoch + 1}/{settings.N2V_EPOCHS} — Loss: {loss.item():.4f}")

        # Extract embeddings
        model.eval()
        with torch.no_grad():
            all_embeddings = model.embedding.weight.cpu().numpy()

        self.embeddings = {
            node_list[i]: all_embeddings[i]
            for i in range(len(node_list))
        }

        print(f"  ✓ Node2Vec: {len(self.embeddings)} node embeddings computed")
        return self.embeddings

    def _fit_fallback(self, G: nx.Graph) -> dict[str, np.ndarray]:
        """Fallback: use graph-based feature hashing when PyG is unavailable."""
        print("  Computing fallback graph embeddings...")

        node_list = list(G.nodes())
        n = len(node_list)

        # Use structural features as pseudo-embeddings
        for node in node_list:
            degree = G.degree(node)
            neighbors = list(G.neighbors(node))
            avg_neighbor_degree = np.mean([G.degree(nb) for nb in neighbors]) if neighbors else 0

            # Create a feature vector
            features = np.zeros(self.embedding_dim)
            features[0] = degree
            features[1] = avg_neighbor_degree
            features[2] = nx.clustering(G, node) if degree > 1 else 0

            # Hash-based features for remaining dimensions
            node_hash = hash(node)
            for i in range(3, self.embedding_dim):
                features[i] = ((node_hash * (i + 1)) % 1000) / 1000.0

            self.embeddings[node] = features

        print(f"  ✓ Fallback embeddings: {len(self.embeddings)} nodes")
        return self.embeddings

    def get_embedding(self, node_id: str) -> np.ndarray:
        """Get embedding for a single node."""
        return self.embeddings.get(node_id, np.zeros(self.embedding_dim))

    def nearest(self, node_id: str, k: int = 5, candidates: Optional[set] = None) -> list[tuple[str, float]]:
        """
        Nearest neighbors of `node_id` by cosine similarity over the learned
        Node2Vec embedding space — wallets that behave/connect similarly even
        without a direct graph edge between them, which topology-only
        clustering (Louvain) can't surface on its own.

        `candidates`: restrict the search to this set of node ids (e.g. only
        wallet-type nodes) — the embedding space mixes wallet/tx/ip nodes.
        """
        if node_id not in self.embeddings:
            return []

        query = self.embeddings[node_id]
        query_norm = np.linalg.norm(query)
        if query_norm == 0:
            return []

        pool = candidates if candidates is not None else self.embeddings.keys()
        scored = []
        for other_id in pool:
            if other_id == node_id or other_id not in self.embeddings:
                continue
            vec = self.embeddings[other_id]
            vec_norm = np.linalg.norm(vec)
            if vec_norm == 0:
                continue
            similarity = float(np.dot(query, vec) / (query_norm * vec_norm))
            scored.append((other_id, similarity))

        scored.sort(key=lambda x: -x[1])
        return scored[:k]

    def save(self, path: Path = None) -> None:
        """Save embeddings to disk."""
        path = path or settings.MODELS_DIR
        path.mkdir(parents=True, exist_ok=True)
        np.savez(path / "node2vec_embeddings.npz", **self.embeddings)
        print(f"  ✓ Embeddings saved to {path / 'node2vec_embeddings.npz'}")

    def load(self, path: Path = None) -> bool:
        """Load embeddings from disk."""
        path = path or settings.MODELS_DIR
        emb_file = path / "node2vec_embeddings.npz"
        if not emb_file.exists():
            return False

        data = np.load(emb_file)
        self.embeddings = {k: data[k] for k in data.files}
        print(f"  ✓ Loaded {len(self.embeddings)} embeddings from disk")
        return True
