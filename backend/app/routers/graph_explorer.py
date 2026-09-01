"""
ChainTrace Forensics — Graph Explorer Router
Serves graph data and subgraph queries for the Sigma.js frontend.
"""

from fastapi import APIRouter, Query
from app.ml.trainer import get_entity_graph, get_clusters
from app.graph.serializer import graph_to_json
from app.graph.builder import get_subgraph, get_graph_stats
from typing import Optional

router = APIRouter(prefix="/api/graph", tags=["Graph Explorer"])


@router.get("/data")
def get_graph_data(
    layout: str = "spring",
    max_nodes: int = 1500,
    node_type: Optional[str] = None,
):
    """Get full graph data for visualization."""
    G = get_entity_graph()
    if G is None:
        return {"nodes": [], "edges": [], "clusters": {}, "stats": {}}

    # Optionally filter by node type
    if node_type:
        nodes = [n for n, d in G.nodes(data=True) if d.get("node_type") == node_type]
        # Include connected nodes
        extended = set(nodes)
        for n in nodes:
            for neighbor in G.neighbors(n):
                extended.add(neighbor)
        G = G.subgraph(extended).copy()

    graph_data = graph_to_json(G, layout=layout, max_nodes=max_nodes)
    return graph_data.model_dump()


@router.get("/subgraph/{entity_id}")
def get_entity_subgraph(entity_id: str, hops: int = 2, layout: str = "spring"):
    """Get N-hop subgraph around a specific entity."""
    G = get_entity_graph()
    if G is None or entity_id not in G:
        return {"nodes": [], "edges": [], "clusters": {}, "stats": {}}

    sub = get_subgraph(G, entity_id, hops=hops)
    graph_data = graph_to_json(sub, layout=layout, max_nodes=500)
    return graph_data.model_dump()


@router.get("/stats")
def get_stats():
    """Get graph statistics."""
    G = get_entity_graph()
    if G is None:
        return {"total_nodes": 0, "total_edges": 0}

    return get_graph_stats(G)


@router.get("/clusters")
def list_clusters():
    """List all wallet clusters with summary stats."""
    from app.graph.clustering import get_cluster_summary
    G = get_entity_graph()
    clusters = get_clusters()

    if not G or not clusters:
        return []

    return get_cluster_summary(G, clusters)


@router.get("/search")
def search_graph(q: str = "", limit: int = 20):
    """Search for entities in the graph by ID prefix."""
    G = get_entity_graph()
    if not G or not q:
        return []

    q_lower = q.lower()
    results = []

    for node, data in G.nodes(data=True):
        if q_lower in node.lower():
            results.append({
                "id": node,
                "node_type": data.get("node_type", "unknown"),
                "risk_tier": data.get("risk_tier"),
                "anomaly_score": data.get("anomaly_score"),
            })
            if len(results) >= limit:
                break

    return results
