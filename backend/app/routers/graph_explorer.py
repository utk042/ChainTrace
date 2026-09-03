"""
ChainTrace Forensics — Graph Explorer Router
Serves graph data, entity detail, expansion and path queries for the
Sigma.js frontend.
"""

import networkx as nx
from fastapi import APIRouter, Query
from typing import Optional

from app.database import get_db_readonly
from app.graph.builder import get_subgraph, get_graph_stats, build_entity_graph
from app.graph.serializer import graph_to_json, NODE_COLORS, RISK_COLORS, _node_size, _truncate
from app.ml.trainer import get_entity_graph, get_clusters

router = APIRouter(prefix="/api/graph", tags=["Graph Explorer"])


def _tx_count() -> int:
    """Number of transactions on disk, 0 if the table isn't reachable."""
    try:
        with get_db_readonly() as con:
            return con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    except Exception:
        return 0


def _resolve_graph() -> Optional[nx.Graph]:
    """
    The entity graph, rebuilding it from DuckDB if this process doesn't have
    one in memory yet.

    The graph lives in module state, so any process that didn't run the
    pipeline itself — a fresh worker, a container restarted by the host, a
    free-tier dyno woken from sleep — starts with `None` even though the
    ingested data is sitting right there on disk. Returning an empty graph in
    that case is what made the explorer come up blank "sometimes"; rebuilding
    on demand costs one pass over the transactions table and makes the page
    load deterministic instead.
    """
    G = get_entity_graph()
    if G is not None and G.number_of_nodes() > 0:
        return G

    if _tx_count() == 0:
        return None

    from app.ml import trainer
    try:
        G = build_entity_graph()
        trainer._entity_graph = G
        if trainer._clusters is None:
            from app.graph.clustering import cluster_wallets
            trainer._clusters = cluster_wallets(G)
        _decorate_with_scores(G)
        return G
    except Exception as e:
        print(f"⚠ On-demand graph rebuild failed: {e}")
        return None


def _decorate_with_scores(G: nx.Graph) -> None:
    """
    Copy anomaly scores / risk tiers / cluster ids from wallet_features onto
    the rebuilt graph, so a rebuilt graph is coloured the same as one the
    pipeline just produced.
    """
    try:
        with get_db_readonly() as con:
            rows = con.execute(
                "SELECT address, anomaly_score, risk_tier, cluster_id FROM wallet_features"
            ).fetchall()
    except Exception:
        return

    for address, score, tier, cluster_id in rows:
        if address in G:
            G.nodes[address]["anomaly_score"] = score or 0.0
            G.nodes[address]["risk_tier"] = tier or "Normal"
            if cluster_id is not None:
                G.nodes[address]["cluster_id"] = cluster_id


def _empty_payload(reason: str) -> dict:
    return {
        "nodes": [], "edges": [], "clusters": {},
        "stats": {"total_nodes": 0, "total_edges": 0, "cluster_count": 0},
        "ready": False,
        "reason": reason,
    }


@router.get("/data")
def get_graph_data(
    layout: str = "spring",
    max_nodes: int = 1500,
    node_type: Optional[str] = None,
    min_score: float = 0.0,
):
    """Get full graph data for visualization."""
    G = _resolve_graph()
    if G is None:
        return _empty_payload(
            "No data ingested yet. Run the pipeline from the Ingest page."
            if _tx_count() == 0 else
            "The entity graph could not be built from the ingested data."
        )

    # Optionally filter by node type, keeping each kept node's neighbourhood
    # so the result is still a connected picture rather than a dust cloud.
    if node_type:
        seeds = [n for n, d in G.nodes(data=True) if d.get("node_type") == node_type]
        extended = set(seeds)
        for n in seeds:
            extended.update(G.neighbors(n))
        G = G.subgraph(extended).copy()

    if min_score > 0:
        seeds = [n for n, d in G.nodes(data=True)
                 if (d.get("anomaly_score") or 0.0) >= min_score]
        extended = set(seeds)
        for n in seeds:
            extended.update(G.neighbors(n))
        G = G.subgraph(extended).copy()

    if G.number_of_nodes() == 0:
        return _empty_payload("No entities match the current filters.")

    payload = graph_to_json(G, layout=layout, max_nodes=max_nodes).model_dump()
    payload["ready"] = True
    return payload


@router.get("/subgraph/{entity_id:path}")
def get_entity_subgraph(entity_id: str, hops: int = 2, layout: str = "spring",
                        max_nodes: int = 600):
    """Get N-hop subgraph around a specific entity."""
    G = _resolve_graph()
    if G is None:
        return _empty_payload("No data ingested yet.")
    if entity_id not in G:
        return _empty_payload(f"'{entity_id}' is not present in the current graph.")

    sub = get_subgraph(G, entity_id, hops=hops)
    payload = graph_to_json(sub, layout=layout, max_nodes=max_nodes).model_dump()
    payload["ready"] = True
    payload["focus"] = entity_id
    return payload


@router.get("/neighbors/{entity_id:path}")
def expand_entity(entity_id: str, limit: int = 60):
    """
    One hop out from a node, as a nodes+edges fragment the frontend merges
    into the graph it already has.

    This is what "expand" should do — grow the picture the investigator has
    been building, rather than replacing it with a fresh subgraph and
    throwing away everything they'd already pulled onto the canvas.
    """
    G = _resolve_graph()
    if G is None or entity_id not in G:
        return {"nodes": [], "edges": [], "truncated": False, "total_neighbors": 0}

    neighbors = list(G.neighbors(entity_id))
    total = len(neighbors)
    # Highest-degree neighbours first: those are the ones that connect onward.
    neighbors.sort(key=lambda n: -G.degree(n))
    neighbors = neighbors[:limit]

    keep = set(neighbors) | {entity_id}
    sub = G.subgraph(keep)

    nodes = []
    for node_id in keep:
        data = G.nodes[node_id]
        node_type = data.get("node_type", "unknown")
        tier = data.get("risk_tier", "Normal")
        score = data.get("anomaly_score") or 0.0
        degree = G.degree(node_id)
        nodes.append({
            "id": node_id,
            "label": _truncate(node_id),
            "node_type": node_type,
            "size": _node_size(node_type, degree, score),
            "color": RISK_COLORS.get(tier) or NODE_COLORS.get(node_type, "#5C6473"),
            "cluster_id": data.get("cluster_id"),
            "risk_tier": tier if tier != "Normal" else None,
            "anomaly_score": score if score > 0 else None,
            "metadata": {"degree": degree},
        })

    edges = [
        {
            "id": f"x{i}",
            "source": u,
            "target": v,
            "edge_type": d.get("edge_type", "unknown"),
            "weight": d.get("weight", 1.0),
        }
        for i, (u, v, d) in enumerate(sub.edges(data=True))
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "truncated": total > limit,
        "total_neighbors": total,
    }


@router.get("/path")
def find_path(source: str, target: str, max_hops: int = 8):
    """
    Shortest connection between two entities.

    The question an investigator actually asks of a link chart — "is this
    wallet connected to that one, and how?" — which previously had no answer
    anywhere in the product.
    """
    G = _resolve_graph()
    if G is None:
        return {"found": False, "reason": "No graph loaded."}
    if source not in G:
        return {"found": False, "reason": f"'{source}' not in graph."}
    if target not in G:
        return {"found": False, "reason": f"'{target}' not in graph."}
    if source == target:
        return {"found": False, "reason": "Source and target are the same entity."}

    try:
        path = nx.shortest_path(G, source, target)
    except nx.NetworkXNoPath:
        return {"found": False, "reason": "No connecting path exists in the graph."}

    if len(path) - 1 > max_hops:
        return {
            "found": False,
            "reason": f"Shortest path is {len(path) - 1} hops, beyond the {max_hops}-hop limit.",
        }

    hops = []
    for u, v in zip(path, path[1:]):
        data = G.get_edge_data(u, v) or {}
        hops.append({
            "source": u,
            "target": v,
            "edge_type": data.get("edge_type", "unknown"),
            "amount": data.get("amount"),
        })

    return {
        "found": True,
        "path": [
            {
                "id": n,
                "node_type": G.nodes[n].get("node_type", "unknown"),
                "risk_tier": G.nodes[n].get("risk_tier"),
                "anomaly_score": G.nodes[n].get("anomaly_score"),
            }
            for n in path
        ],
        "hops": hops,
        "length": len(path) - 1,
    }


@router.get("/node/{entity_id:path}")
def node_detail(entity_id: str):
    """
    Everything known about one entity, assembled for the inspector panel:
    graph position, behavioural features, alerts raised against it, and its
    strongest counterparties.
    """
    G = _resolve_graph()
    if G is None or entity_id not in G:
        return {"found": False, "id": entity_id}

    data = dict(G.nodes[entity_id])
    node_type = data.get("node_type", "unknown")
    neighbors = list(G.neighbors(entity_id))

    neighbor_types: dict[str, int] = {}
    for n in neighbors:
        nt = G.nodes[n].get("node_type", "unknown")
        neighbor_types[nt] = neighbor_types.get(nt, 0) + 1

    # Strongest links first — for a wallet this surfaces the transactions
    # moving the most value, which is where an investigator looks next.
    counterparties = []
    for n in sorted(neighbors, key=lambda x: -G.degree(x))[:8]:
        edge = G.get_edge_data(entity_id, n) or {}
        counterparties.append({
            "id": n,
            "node_type": G.nodes[n].get("node_type", "unknown"),
            "edge_type": edge.get("edge_type", "unknown"),
            "amount": edge.get("amount"),
            "risk_tier": G.nodes[n].get("risk_tier"),
            "anomaly_score": G.nodes[n].get("anomaly_score"),
            "degree": G.degree(n),
        })

    detail = {
        "found": True,
        "id": entity_id,
        "node_type": node_type,
        "degree": G.degree(entity_id),
        "cluster_id": data.get("cluster_id"),
        "risk_tier": data.get("risk_tier"),
        "anomaly_score": data.get("anomaly_score"),
        "neighbor_types": neighbor_types,
        "counterparties": counterparties,
        "attributes": {k: v for k, v in data.items()
                       if k not in ("node_type", "cluster_id", "risk_tier", "anomaly_score")},
        "features": None,
        "alerts": [],
        "geo": None,
    }

    try:
        with get_db_readonly() as con:
            if node_type == "wallet":
                row = con.execute("""
                    SELECT tx_count, total_received, total_sent, fan_in_degree,
                           fan_out_degree, avg_tx_amount, velocity_1h, velocity_24h,
                           round_amount_ratio, unique_ips, unique_countries,
                           first_seen, last_seen, age_days, cluster_id,
                           anomaly_score, risk_tier, peel_chain_depth, peel_chain_role,
                           mixer_interaction_count, darknet_proximity_hops
                    FROM wallet_features WHERE address = ?
                """, (entity_id,)).fetchone()
                if row:
                    keys = ["tx_count", "total_received", "total_sent", "fan_in_degree",
                            "fan_out_degree", "avg_tx_amount", "velocity_1h", "velocity_24h",
                            "round_amount_ratio", "unique_ips", "unique_countries",
                            "first_seen", "last_seen", "age_days", "cluster_id",
                            "anomaly_score", "risk_tier", "peel_chain_depth",
                            "peel_chain_role", "mixer_interaction_count",
                            "darknet_proximity_hops"]
                    features = {k: (str(v) if k in ("first_seen", "last_seen") and v else v)
                                for k, v in zip(keys, row)}
                    detail["features"] = features
                    detail["risk_tier"] = features.get("risk_tier") or detail["risk_tier"]
                    if features.get("anomaly_score"):
                        detail["anomaly_score"] = features["anomaly_score"]

            elif node_type == "ip":
                row = con.execute("""
                    SELECT country, city, asn, org, latitude, longitude, hit_count
                    FROM ip_metadata WHERE ip_address = ?
                """, (entity_id,)).fetchone()
                if row:
                    detail["geo"] = dict(zip(
                        ["country", "city", "asn", "org", "latitude", "longitude", "hit_count"],
                        row))

            elif node_type == "transaction":
                row = con.execute("""
                    SELECT timestamp, src_ip, dst_ip, fee, script_type,
                           input_addresses, output_addresses,
                           input_amounts, output_amounts
                    FROM transactions WHERE txid = ?
                """, (entity_id,)).fetchone()
                if row:
                    detail["features"] = {
                        "timestamp": str(row[0]) if row[0] else None,
                        "src_ip": row[1], "dst_ip": row[2], "fee": row[3],
                        "script_type": row[4],
                        "input_count": len(row[5] or []),
                        "output_count": len(row[6] or []),
                        "total_input": sum(row[7] or []),
                        "total_output": sum(row[8] or []),
                    }

            alert_rows = con.execute("""
                SELECT alert_id, risk_tier, confidence, model, description, status
                FROM alerts WHERE entity_id = ?
                ORDER BY confidence DESC LIMIT 5
            """, (entity_id,)).fetchall()
            detail["alerts"] = [
                {"alert_id": a[0], "risk_tier": a[1], "confidence": a[2],
                 "model": a[3], "description": a[4], "status": a[5]}
                for a in alert_rows
            ]
    except Exception as e:
        print(f"⚠ node_detail enrichment failed for {entity_id}: {e}")

    return detail


@router.get("/stats")
def get_stats():
    """Get graph statistics."""
    G = _resolve_graph()
    if G is None:
        return {"total_nodes": 0, "total_edges": 0, "ready": False}

    stats = get_graph_stats(G)
    stats["ready"] = True
    return stats


@router.get("/clusters")
def list_clusters():
    """List all wallet clusters with summary stats."""
    from app.graph.clustering import get_cluster_summary
    G = _resolve_graph()
    clusters = get_clusters()

    if not G or not clusters:
        return []

    return get_cluster_summary(G, clusters)


@router.get("/search")
def search_graph(q: str = "", limit: int = 20, node_type: Optional[str] = None):
    """
    Search for entities in the graph by substring.

    Ranked rather than first-come: exact match, then prefix, then substring,
    with higher-degree and higher-risk nodes ahead of isolated ones — the
    previous version stopped at the first 20 nodes iteration order happened
    to hit, which for a long address prefix routinely missed the wallet the
    investigator had typed out in full.
    """
    G = _resolve_graph()
    if not G or not q:
        return []

    q_lower = q.lower()
    scored = []

    for node, data in G.nodes(data=True):
        if node_type and data.get("node_type") != node_type:
            continue
        node_lower = node.lower()
        if q_lower not in node_lower:
            continue

        if node_lower == q_lower:
            rank = 0
        elif node_lower.startswith(q_lower):
            rank = 1
        else:
            rank = 2

        scored.append((
            rank,
            -(data.get("anomaly_score") or 0.0),
            -G.degree(node),
            node,
            data,
        ))

    scored.sort(key=lambda t: t[:4])

    return [
        {
            "id": node,
            "node_type": data.get("node_type", "unknown"),
            "risk_tier": data.get("risk_tier"),
            "anomaly_score": data.get("anomaly_score"),
            "degree": G.degree(node),
        }
        for _, _, _, node, data in scored[:limit]
    ]
