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
    "wallet": "#5FD4D0",
    "ip": "#B28EE0",
    "transaction": "#5C6473",
}

RISK_COLORS = {
    "Critical": "#EF4444",
    "High": "#F0883E",
    "Elevated": "#E0B23C",
    "Normal": None,  # Use type color
}

# On-screen radii in pixels at zoom 1 (Sigma treats `size` literally).
# Wallets get the widest range; transactions and IPs stay small.
SIZE_RANGE = {
    "wallet": (3.0, 11.0),
    "ip": (2.5, 7.0),
    "transaction": (2.0, 5.5),
    "unknown": (2.5, 6.0),
}

# Degree at which a node reaches the top of its size range; beyond this the
# size saturates so a single high-degree hub cannot flatten everything else.
DEGREE_SATURATION = 40.0


def _node_size(node_type: str, degree: int, anomaly_score: float) -> float:
    """
    Node radius in screen pixels: connectivity first, with a bump for risk.

    sqrt makes area rather than radius scale with degree, which keeps the
    growth perceptually even.
    """
    lo, hi = SIZE_RANGE.get(node_type, SIZE_RANGE["unknown"])
    ratio = min(1.0, math.sqrt(max(0, degree) / DEGREE_SATURATION))
    size = lo + (hi - lo) * ratio
    # Up to 25% larger, so an isolated high-risk node stays findable.
    if anomaly_score:
        size *= 1.0 + 0.25 * min(1.0, anomaly_score / 100.0)
    return round(size, 2)


def _truncate(node_id: str, keep_head: int = 8, keep_tail: int = 6) -> str:
    if len(node_id) <= keep_head + keep_tail + 3:
        return node_id
    return f"{node_id[:keep_head]}…{node_id[-keep_tail:]}"


# Which relationships are a movement of value, and which are an inference or
# an observation. Only a flow gets an arrowhead: drawing one on a co-input
# edge would assert that one wallet paid another, when all the heuristic says
# is that the two were spent together.
EDGE_COLORS = {
    "wallet_input": "#3A6E7A",      # wallet -> transaction (a spend)
    "wallet_output": "#3A6E55",     # transaction -> wallet (a receipt)
    "co_input": "#8A5A5F",          # co-ownership inference, undirected
    "ip_observed_tx": "#4A3F63",    # network observation, undirected
    "unknown": "#242932",
}

FLOW_EDGE_TYPES = frozenset({"wallet_input", "wallet_output"})


def _serialize_edges(G: nx.Graph) -> list[GraphEdge]:
    """
    Edges in the direction the money actually moved.

    The graph is undirected, so `G.edges()` hands back each pair in whatever
    order the adjacency happens to hold — which meant the client drew an
    arrowhead pointing whichever way the iteration fell. A wallet's three
    transactions all looked alike; nothing on screen said which were spends
    and which were receipts.

    The direction is not stored on the edge, it is implied by the roles the
    builder recorded: `spent` is the wallet paying into the transaction,
    `received` is the transaction paying out to it. A change address has both,
    and becomes two edges, because it really is two flows.
    """
    edges: list[GraphEdge] = []
    counter = 0

    def emit(source, target, edge_type, data, amount=None):
        nonlocal counter
        metadata = {k: v for k, v in data.items()
                    if k not in ("edge_type", "weight", "spent", "received")}
        if amount is not None:
            metadata["amount"] = amount
        edges.append(GraphEdge(
            id=f"e{counter}",
            source=source,
            target=target,
            edge_type=edge_type,
            weight=data.get("weight", 1.0),
            color=EDGE_COLORS.get(edge_type, EDGE_COLORS["unknown"]),
            metadata={**metadata, "directed": edge_type in FLOW_EDGE_TYPES},
        ))
        counter += 1

    for u, v, data in G.edges(data=True):
        edge_type = data.get("edge_type", "unknown")

        if edge_type in ("wallet_input", "wallet_output", "wallet_change"):
            # Orient by node type, not by the order the pair came out of the
            # adjacency: whichever endpoint is the transaction is the one the
            # spend points at and the receipt points away from.
            if G.nodes[u].get("node_type") == "transaction":
                txid, wallet = u, v
            else:
                wallet, txid = u, v

            spent = data.get("spent")
            received = data.get("received")
            # A graph built before this split carries neither; fall back to
            # the single `amount` and the type that was recorded.
            if spent is None and received is None:
                amount = data.get("amount")
                if edge_type == "wallet_output":
                    emit(txid, wallet, "wallet_output", data, amount)
                else:
                    emit(wallet, txid, "wallet_input", data, amount)
                continue

            if spent is not None:
                emit(wallet, txid, "wallet_input", data, spent)
            if received is not None:
                emit(txid, wallet, "wallet_output", data, received)
            continue

        emit(u, v, edge_type, data, data.get("amount"))

    return edges


def graph_to_json(
    G: nx.Graph,
    layout: str = "spring",
    max_nodes: int = 1500,
) -> GraphData:
    """
    Convert a NetworkX graph to the frontend GraphData schema.

    Args:
        G: NetworkX graph
        layout: Layout algorithm ('random', 'spring', 'kamada_kawai')
        max_nodes: Maximum nodes to include (sample if larger)
    """
    full_node_count = G.number_of_nodes()
    full_edge_count = G.number_of_edges()
    truncated = full_node_count > max_nodes

    # Sample if too large
    if truncated:
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
        anomaly_score = data.get("anomaly_score") or 0.0
        degree = G.degree(node_id)

        color = RISK_COLORS.get(risk_tier) or NODE_COLORS.get(node_type, "#5C6473")
        pos = positions.get(node_id, (random.uniform(-1, 1), random.uniform(-1, 1)))

        # Enough for the client to render a node without a second request;
        # the detail endpoint adds counterparties and alerts.
        metadata = {k: v for k, v in data.items()
                    if k not in ("node_type", "cluster_id", "risk_tier", "anomaly_score")}
        metadata["degree"] = degree

        nodes.append(GraphNode(
            id=node_id,
            label=_truncate(node_id),
            node_type=node_type,
            x=pos[0] * 500,  # Scale for Sigma.js
            y=pos[1] * 500,
            size=_node_size(node_type, degree, anomaly_score),
            color=color,
            cluster_id=data.get("cluster_id"),
            risk_tier=risk_tier if risk_tier != "Normal" else None,
            anomaly_score=anomaly_score if anomaly_score > 0 else None,
            metadata=metadata,
        ))

    edges = _serialize_edges(G)

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
        # Lets the client distinguish a sampled view from a complete one.
        "truncated": truncated,
        "graph_total_nodes": full_node_count,
        "graph_total_edges": full_edge_count,
    }

    return GraphData(nodes=nodes, edges=edges, clusters=clusters, stats=stats)



def _clustered_circular_layout(G: nx.Graph) -> dict:
    """
    Nodes arranged as one ring per cluster, the rings laid out on a circle.

    `nx.circular_layout` puts every node on a single ring in graph order. At
    the sizes this tool loads that is not a layout — a thousand tiles form the
    rim and every edge crosses the middle, so the canvas is a ring around a
    solid disc of lines and nothing can be read off it. Worse, the ordering is
    arbitrary, so adjacency on the rim means nothing: two neighbours on screen
    are not related.

    Grouping by cluster makes the arrangement carry information. Each cluster
    gets its own small ring, the rings are placed around a larger circle, and
    a cluster's internal edges stay short and local instead of crossing the
    whole canvas. Unclustered nodes go to an outer ring of their own rather
    than being scattered through the others.
    """
    nodes = list(G.nodes())
    if not nodes:
        return {}

    groups: dict[object, list[str]] = {}
    for node_id, data in G.nodes(data=True):
        groups.setdefault(data.get("cluster_id"), []).append(node_id)

    # Largest clusters first, so the biggest structures get the outer, roomier
    # positions; the unclustered remainder is placed last.
    unclustered = groups.pop(None, [])
    ordered = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    if unclustered:
        ordered.append((None, unclustered))

    if len(ordered) <= 1:
        # One cluster (or none): a single ring is the honest answer.
        return nx.circular_layout(G)

    positions: dict[str, tuple[float, float]] = {}
    ring_count = len(ordered)
    for index, (_cluster_id, members) in enumerate(ordered):
        angle = 2 * math.pi * index / ring_count
        # Ring centres on the unit circle, scaled so the biggest cluster's
        # own ring still fits between its neighbours.
        cx = math.cos(angle) * 0.72
        cy = math.sin(angle) * 0.72
        # A ring's radius grows with its membership but is capped, so one huge
        # cluster cannot swallow the others.
        radius = min(0.26, 0.02 + 0.02 * math.sqrt(len(members)))
        if len(members) == 1:
            positions[members[0]] = (cx, cy)
            continue
        for j, member in enumerate(members):
            theta = 2 * math.pi * j / len(members)
            positions[member] = (cx + math.cos(theta) * radius,
                                 cy + math.sin(theta) * radius)

    return positions


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
        elif layout == "circular":
            return _clustered_circular_layout(G)
        else:
            # Random layout with some structure
            return nx.spring_layout(G, k=2.0, iterations=20, seed=42)
    except Exception:
        return {n: (random.uniform(-1, 1), random.uniform(-1, 1)) for n in G.nodes()}
