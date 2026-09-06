"""
ChainTrace Forensics — Wallet Clustering
Louvain community detection + multi-input ownership heuristic.
"""

import networkx as nx
from community import community_louvain
from app.config import settings


def _entity_of(G: nx.Graph, address: str) -> str:
    """The actor an address belongs to, falling back to the address itself."""
    data = G.nodes[address] if address in G else {}
    entity_id = data.get("entity_id")
    if entity_id:
        return entity_id
    index = G.graph.get("entities")
    return index.entity(address) if index else address


def cluster_wallets(G: nx.Graph) -> dict[int, list[str]]:
    """
    Louvain community detection over the *entity* flow graph.

    This used to run over addresses, on a wallet graph whose dominant feature
    was the co-input cliques: every pair of co-spending addresses carried a
    weight of 5 from the `co_input` edge plus 3 more for each transaction they
    shared, and the same cliques were rebuilt here from the transaction
    structure a second time. So Louvain spent most of its work rediscovering,
    approximately and at O(N²) cost per transaction, a partition that
    common-input-ownership already defines exactly (app/graph/entities.py).
    A 224-input consolidation alone put 24,976 weighted pairs into that graph.

    Contracting each entity to one node first removes the tautology. What is
    left to find is the thing Louvain is actually good for: which *actors* move
    value between each other often enough to look like one operation. The
    communities it returns are then mapped back onto every member address, so
    `cluster_id` still means the same thing to everything downstream.

    Returns: {cluster_id: [wallet_address, ...]}
    """
    wallet_nodes = [n for n, d in G.nodes(data=True) if d.get("node_type") == "wallet"]

    if len(wallet_nodes) < 2:
        return {0: wallet_nodes}

    # address -> entity, and the reverse, computed once.
    entity_of = {w: _entity_of(G, w) for w in wallet_nodes}
    members: dict[str, list[str]] = {}
    for address, entity in entity_of.items():
        members.setdefault(entity, []).append(address)

    # ── The actor-to-actor flow graph ──────────────────────────────
    W = nx.Graph()
    W.add_nodes_from(members)

    for node, node_data in G.nodes(data=True):
        if node_data.get("node_type") != "transaction":
            continue

        # Every address funding one transaction is the same actor by
        # construction, so the inputs collapse to a single entity and the
        # pairwise input-to-input loop this used to run has nothing left to do.
        senders: set[str] = set()
        receivers: set[str] = set()
        for neighbor in G.neighbors(node):
            if G.nodes[neighbor].get("node_type") != "wallet":
                continue
            edge_type = G.edges[neighbor, node].get("edge_type", "")
            entity = entity_of.get(neighbor) or _entity_of(G, neighbor)
            # A change address is both, and was previously counted as neither:
            # the old check tested for 'wallet_input'/'wallet_output' exactly,
            # so every address that funded a transaction and took change back
            # dropped out of the clustering signal entirely.
            if edge_type in ("wallet_input", "wallet_change"):
                senders.add(entity)
            if edge_type in ("wallet_output", "wallet_change"):
                receivers.add(entity)

        for sender in senders:
            for receiver in receivers:
                if sender == receiver:
                    continue
                if W.has_edge(sender, receiver):
                    W[sender][receiver]["weight"] += 1.0
                else:
                    W.add_edge(sender, receiver, weight=1.0)

    # Remove isolated entities (no flows in or out of anything else)
    isolated = list(nx.isolates(W))
    connected_W = W.copy()
    connected_W.remove_nodes_from(isolated)

    if connected_W.number_of_nodes() < 2:
        clusters: dict[int, list[str]] = {0: wallet_nodes}
    else:
        partition = community_louvain.best_partition(
            connected_W,
            resolution=settings.LOUVAIN_RESOLUTION,
            random_state=42,
        )

        # Back from actors to addresses: every member of an entity inherits the
        # community that entity landed in.
        clusters = {}
        for entity, cluster_id in partition.items():
            clusters.setdefault(cluster_id, []).extend(members.get(entity, []))

        # An entity nothing flows to or from is its own cluster — but it is one
        # cluster for the whole actor, not one per address it holds.
        next_id = max(clusters.keys()) + 1 if clusters else 0
        for entity in isolated:
            clusters[next_id] = list(members.get(entity, []))
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
