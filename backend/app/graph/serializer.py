"""
ChainTrace Forensics — Graph Serializer
Converts NetworkX graphs to JSON format for the React/Sigma.js frontend.
"""

import math
import random
import networkx as nx
from app.models.graph import GraphNode, GraphEdge, GraphData


# Color map by node type and risk
NODE_COLORS = {
    "wallet": "#4D9FFF",
    "ip": "#8B5CF6",
    "transaction": "#6B7280",
}

RISK_COLORS = {
    "Critical": "#FF4D5A",
    "High": "#FF6B7A",
    "Elevated": "#FFB84D",
    "Normal": None,  # Use type color
}


def graph_to_json(
    G: nx.Graph,
    layout: str = "random",
    max_nodes: int = 2000,
) -> GraphData:
    """
    Convert a NetworkX graph to the frontend GraphData schema.

    Args:
        G: NetworkX graph
        layout: Layout algorithm ('random', 'spring', 'kamada_kawai')
        max_nodes: Maximum nodes to include (sample if larger)
    """
    # Sample if too large
    if G.number_of_nodes() > max_nodes:
        # Prioritize wallet nodes with high degree
        wallet_nodes = [(n, G.degree(n)) for n, d in G.nodes(data=True)
                        if d.get("node_type") == "wallet"]
        wallet_nodes.sort(key=lambda x: -x[1])
        keep_wallets = [n for n, _ in wallet_nodes[:max_nodes // 2]]

        # Include connected TX and IP nodes
        keep = set(keep_wallets)
        for w in keep_wallets:
            for neighbor in G.neighbors(w):
                keep.add(neighbor)
                if len(keep) >= max_nodes:
                    break
            if len(keep) >= max_nodes:
                break

        G = G.subgraph(keep).copy()

    # Compute layout positions
    positions = _compute_layout(G, layout)

    # Build nodes
    nodes = []
    for node_id, data in G.nodes(data=True):
        node_type = data.get("node_type", "unknown")
        risk_tier = data.get("risk_tier", "Normal")
        anomaly_score = data.get("anomaly_score", 0.0)

        color = RISK_COLORS.get(risk_tier) or NODE_COLORS.get(node_type, "#6B7280")

        # Size based on degree (log scale)
        degree = G.degree(node_id)
        size = max(3, min(20, 3 + math.log2(1 + degree) * 3))

        pos = positions.get(node_id, (random.uniform(-1, 1), random.uniform(-1, 1)))

        # Label: truncate long IDs
        label = node_id
        if len(label) > 16:
            label = f"{label[:8]}...{label[-6:]}"

        nodes.append(GraphNode(
            id=node_id,
            label=label,
            node_type=node_type,
            x=pos[0] * 500,  # Scale for Sigma.js
            y=pos[1] * 500,
            size=size,
            color=color,
            cluster_id=data.get("cluster_id"),
            risk_tier=risk_tier if risk_tier != "Normal" else None,
            anomaly_score=anomaly_score if anomaly_score > 0 else None,
            metadata={k: v for k, v in data.items()
                      if k not in ("node_type", "cluster_id", "risk_tier", "anomaly_score")},
        ))

    # Build edges
    edges = []
    for i, (u, v, data) in enumerate(G.edges(data=True)):
        edge_type = data.get("edge_type", "unknown")
        color = "#2A2F3A"
        if edge_type == "co_input":
            color = "#FF6B7A55"  # Semi-transparent coral
        elif edge_type == "wallet_input":
            color = "#4D9FFF55"
        elif edge_type == "wallet_output":
            color = "#4DFF8855"

        edges.append(GraphEdge(
            id=f"e{i}",
            source=u,
            target=v,
            edge_type=edge_type,
            weight=data.get("weight", 1.0),
            color=color,
            metadata={k: v for k, v in data.items()
                      if k not in ("edge_type", "weight")},
        ))

    # Build cluster map
    clusters: dict[int, list[str]] = {}
    for node_id, data in G.nodes(data=True):
        cid = data.get("cluster_id")
        if cid is not None:
            clusters.setdefault(cid, []).append(node_id)

    stats = {
        "total_nodes": G.number_of_nodes(),
        "total_edges": G.number_of_edges(),
        "wallet_count": sum(1 for _, d in G.nodes(data=True) if d.get("node_type") == "wallet"),
        "ip_count": sum(1 for _, d in G.nodes(data=True) if d.get("node_type") == "ip"),
        "tx_count": sum(1 for _, d in G.nodes(data=True) if d.get("node_type") == "transaction"),
        "cluster_count": len(clusters),
    }

    return GraphData(nodes=nodes, edges=edges, clusters=clusters, stats=stats)


def _compute_layout(G: nx.Graph, layout: str) -> dict:
    """Compute node positions using the specified layout algorithm."""
    if G.number_of_nodes() == 0:
        return {}

    try:
        if layout == "spring":
            return nx.spring_layout(G, k=1.5 / math.sqrt(max(1, G.number_of_nodes())),
                                    iterations=50, seed=42)
        elif layout == "kamada_kawai":
            if G.number_of_nodes() < 500:
                return nx.kamada_kawai_layout(G)
            else:
                return nx.spring_layout(G, seed=42)
        else:
            # Random layout with some structure
            return nx.spring_layout(G, k=2.0, iterations=20, seed=42)
    except Exception:
        return {n: (random.uniform(-1, 1), random.uniform(-1, 1)) for n in G.nodes()}
