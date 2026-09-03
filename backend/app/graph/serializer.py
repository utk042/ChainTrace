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

# Sigma draws a node at `size` pixels of radius at zoom 1, so these are
# literal on-screen radii, not arbitrary units. Wallets are the entities an
# investigator actually reasons about, so they get the widest range;
# transactions and IPs stay small so they read as connective tissue rather
# than competing for attention.
SIZE_RANGE = {
    "wallet": (3.0, 11.0),
    "ip": (2.5, 7.0),
    "transaction": (2.0, 5.5),
    "unknown": (2.5, 6.0),
}

# Degree at which a node reaches the top of its size range. Beyond this the
# size saturates instead of running away — one 400-edge hub shouldn't flatten
# every other node to a dot.
DEGREE_SATURATION = 40.0


def _node_size(node_type: str, degree: int, anomaly_score: float) -> float:
    """
    Node radius in screen pixels, driven by what the size should actually
    *mean*: connectivity first, with a modest bump for scored risk.

    sqrt keeps the growth perceptually even (area scales with degree rather
    than radius), and the saturation cap stops hubs from dominating.
    """
    lo, hi = SIZE_RANGE.get(node_type, SIZE_RANGE["unknown"])
    ratio = min(1.0, math.sqrt(max(0, degree) / DEGREE_SATURATION))
    size = lo + (hi - lo) * ratio
    # Risk-scored wallets get up to 25% larger so a critical node standing
    # alone on the edge of the graph is still findable.
    if anomaly_score:
        size *= 1.0 + 0.25 * min(1.0, anomaly_score / 100.0)
    return round(size, 2)


def _truncate(node_id: str, keep_head: int = 8, keep_tail: int = 6) -> str:
    if len(node_id) <= keep_head + keep_tail + 3:
        return node_id
    return f"{node_id[:keep_head]}…{node_id[-keep_tail:]}"


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

        # Everything the inspector panel needs to render without a second
        # round-trip; the detail endpoint adds counterparties and alerts.
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

    # Build edges
    edges = []
    for i, (u, v, data) in enumerate(G.edges(data=True)):
        edge_type = data.get("edge_type", "unknown")
        color = "#242932"
        if edge_type == "co_input":
            color = "#8A5A5F"     # co-ownership inference — the strongest claim
        elif edge_type == "wallet_input":
            color = "#3A6E7A"
        elif edge_type == "wallet_output":
            color = "#3A6E55"
        elif edge_type == "ip_observed_tx":
            color = "#4A3F63"

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
        # So the UI can say "showing 1,500 of 8,420" instead of silently
        # presenting a sample as if it were the whole graph.
        "truncated": truncated,
        "graph_total_nodes": full_node_count,
        "graph_total_edges": full_edge_count,
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
        elif layout == "circular":
            return nx.circular_layout(G)
        else:
            # Random layout with some structure
            return nx.spring_layout(G, k=2.0, iterations=20, seed=42)
    except Exception:
        return {n: (random.uniform(-1, 1), random.uniform(-1, 1)) for n in G.nodes()}
