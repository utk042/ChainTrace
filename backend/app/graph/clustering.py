"""
ChainTrace Forensics — Wallet Clustering
Louvain community detection + multi-input ownership heuristic.
"""

import networkx as nx
from community import community_louvain
from app.config import settings


def cluster_wallets(G: nx.Graph) -> dict[int, list[str]]:
    """
    Apply Louvain community detection on the wallet subgraph.

    The wallet subgraph includes:
    - co_input edges (common-input-ownership heuristic)
    - wallet_input/wallet_output edges (transaction flow)

    Returns: {cluster_id: [wallet_address, ...]}
    """
    # Extract wallet-only subgraph with co-input edges
    wallet_nodes = [n for n, d in G.nodes(data=True) if d.get("node_type") == "wallet"]

    if len(wallet_nodes) < 2:
        return {0: wallet_nodes}

    # Build a weighted wallet graph
    W = nx.Graph()
    W.add_nodes_from(wallet_nodes)

    for u, v, data in G.edges(data=True):
        edge_type = data.get("edge_type", "")
        if u in wallet_nodes and v in wallet_nodes:
            if edge_type == "co_input":
                # Strong signal: same entity
                if W.has_edge(u, v):
                    W[u][v]["weight"] += 5.0
                else:
                    W.add_edge(u, v, weight=5.0)

    # Also connect wallets through shared transactions
    for node, node_data in G.nodes(data=True):
        if node_data.get("node_type") == "transaction":
            # Get input and output wallets for this TX
            input_wallets = []
            output_wallets = []
            for neighbor in G.neighbors(node):
                if G.nodes[neighbor].get("node_type") == "wallet":
                    edge_data = G.edges[neighbor, node] if G.has_edge(neighbor, node) else G.edges[node, neighbor]
                    et = edge_data.get("edge_type", "")
                    if et == "wallet_input":
                        input_wallets.append(neighbor)
                    elif et == "wallet_output":
                        output_wallets.append(neighbor)

            # Connect input wallets to each other (co-spending)
            for i in range(len(input_wallets)):
                for j in range(i + 1, len(input_wallets)):
                    u, v = input_wallets[i], input_wallets[j]
                    if W.has_edge(u, v):
                        W[u][v]["weight"] += 3.0
                    else:
                        W.add_edge(u, v, weight=3.0)

            # Connect input to output wallets (weaker signal)
            for iw in input_wallets:
                for ow in output_wallets:
                    if iw != ow:
                        if W.has_edge(iw, ow):
                            W[iw][ow]["weight"] += 1.0
                        else:
                            W.add_edge(iw, ow, weight=1.0)

    # Remove isolated nodes (no edges in wallet graph)
    isolated = list(nx.isolates(W))

    # Run Louvain on the connected wallet graph
    connected_W = W.copy()
    connected_W.remove_nodes_from(isolated)

    if connected_W.number_of_nodes() < 2:
        clusters = {0: wallet_nodes}
    else:
        partition = community_louvain.best_partition(
            connected_W,
            resolution=settings.LOUVAIN_RESOLUTION,
            random_state=42,
        )

        # Group wallets by cluster
        clusters: dict[int, list[str]] = {}
        for wallet, cluster_id in partition.items():
            clusters.setdefault(cluster_id, []).append(wallet)

        # Assign isolated wallets to their own clusters
        next_id = max(clusters.keys()) + 1 if clusters else 0
        for wallet in isolated:
            clusters[next_id] = [wallet]
            next_id += 1

    # Update the main graph with cluster assignments
    for cluster_id, wallets in clusters.items():
        for wallet in wallets:
            if wallet in G:
                G.nodes[wallet]["cluster_id"] = cluster_id

    return clusters


def refine_clusters_with_embeddings(
    G: nx.Graph,
    clusters: dict[int, list[str]],
    embedder,
    similarity_threshold: float = 0.75,
) -> dict[int, list[str]]:
    """
    Louvain is topology-only: a wallet with too little direct graph
    structure (e.g. one observed transaction, no co-input edges) ends up
    alone in its own singleton cluster even when it behaves/connects just
    like an existing entity cluster. This is where the Node2Vec graph
    embeddings this pipeline trains earlier actually get used for entity
    clustering, per Section 4(ii): merge a singleton wallet into the
    non-singleton cluster its *learned embedding* is nearest to, when that
    similarity clears `similarity_threshold`. Topology-confident clusters
    (size > 1) are left untouched — this only rescues the cases Louvain
    alone couldn't resolve.
    """
    embeddings = getattr(embedder, "embeddings", None)
    if not clusters or not embeddings:
        return clusters

    non_singletons = {cid: addrs for cid, addrs in clusters.items() if len(addrs) > 1}
    if not non_singletons:
        return clusters

    wallet_pool = {addr for addrs in non_singletons.values() for addr in addrs}
    merged = {cid: list(addrs) for cid, addrs in clusters.items()}

    for cid, addrs in clusters.items():
        if len(addrs) != 1:
            continue
        wallet = addrs[0]
        if wallet not in embeddings:
            continue

        neighbors = embedder.nearest(wallet, k=1, candidates=wallet_pool)
        if not neighbors:
            continue
        best_match, similarity = neighbors[0]
        if similarity < similarity_threshold:
            continue

        target_cid = next(c for c, a in non_singletons.items() if best_match in a)
        merged[target_cid].append(wallet)
        merged[cid] = []
        if wallet in G:
            G.nodes[wallet]["cluster_id"] = target_cid

    return {cid: addrs for cid, addrs in merged.items() if addrs}


def get_cluster_summary(G: nx.Graph, clusters: dict[int, list[str]]) -> list[dict]:
    """Generate summary stats per cluster."""
    summaries = []

    for cluster_id, wallets in clusters.items():
        total_sent = sum(G.nodes[w].get("total_sent", 0) for w in wallets if w in G)
        total_received = sum(G.nodes[w].get("total_received", 0) for w in wallets if w in G)
        tx_count = sum(G.nodes[w].get("tx_count", 0) for w in wallets if w in G)

        summaries.append({
            "cluster_id": cluster_id,
            "wallet_count": len(wallets),
            "total_sent": round(total_sent, 8),
            "total_received": round(total_received, 8),
            "tx_count": tx_count,
            "wallets": wallets[:10],  # First 10 for display
        })

    return sorted(summaries, key=lambda x: -x["tx_count"])
