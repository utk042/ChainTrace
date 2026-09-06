"""
ChainTrace Forensics — Graph Explorer Router
Serves graph data, entity detail, expansion and path queries for the
Sigma.js frontend.
"""

import networkx as nx
from fastapi import APIRouter, Query
from typing import Optional

from app.database import get_db_readonly
from app.graph.builder import (
    get_subgraph, get_graph_stats, build_entity_graph, apply_scores_from_db,
    collapse_to_entities, is_entity_node_id, entity_id_from_node,
)
from app.graph.serializer import (
    graph_to_json, _serialize_edges, NODE_COLORS, RISK_COLORS, _node_size,
    _truncate, _node_label,
)
from app.ml.trainer import get_entity_graph, get_clusters

from app.logging_config import get_logger

logger = get_logger("app.routers.graph_explorer")

router = APIRouter(prefix="/api/graph", tags=["Graph Explorer"])


def _tx_count() -> int:
    """Number of transactions on disk, 0 if the table isn't reachable."""
    try:
        with get_db_readonly() as con:
            return con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    except Exception:
        # A read failure is not an empty table, and pretending otherwise is
        # how the app came to tell operators to ingest data they already had.
        logger.exception("Could not count transactions")
        return 0


def _resolve_graph() -> Optional[nx.Graph]:
    """
    The entity graph, rebuilt from DuckDB if this process has none in memory.

    The graph is module state, so a process that did not run the pipeline
    itself (a fresh worker, a restarted container) holds None even when the
    ingested data is on disk. Rebuilding costs one pass over the transactions
    table and keeps the response deterministic.

    The transaction count is checked *first*, and an in-memory graph is
    discarded when the table is empty. Module state outlives the rows it came
    from: after a wipe or a failed re-ingest the process still held the last
    run's graph, so `/api/graph/data` returned a full network — which the
    canvas duly rendered, complete with node counts — over a database with
    nothing in it. Every one of those nodes then resolved to nothing when
    clicked, because the detail lookup queried the tables. A graph the
    operator can see but not interrogate is worse than an empty canvas: it
    reads as live evidence.
    """
    tx_count = _tx_count()
    if tx_count == 0:
        G = get_entity_graph()
        if G is not None and G.number_of_nodes() > 0:
            logger.warning(
                "Discarding an in-memory graph of %s nodes: the transactions "
                "table is empty, so it no longer describes any stored data.",
                G.number_of_nodes(),
            )
            from app.ml.trainer import reset_analysis_state
            reset_analysis_state()
        return None

    G = get_entity_graph()
    if G is not None and G.number_of_nodes() > 0:
        return G

    from app.ml import trainer
    try:
        G = build_entity_graph()
        trainer._entity_graph = G
        if trainer._clusters is None:
            from app.graph.clustering import cluster_wallets
            trainer._clusters = cluster_wallets(G)
        apply_scores_from_db(G)
        return G
    except Exception:
        logger.exception("On-demand graph rebuild failed")
        return None


def _entity_view(G: nx.Graph) -> nx.Graph:
    """
    The address graph with every co-spending group drawn as one actor.

    Cached on the source graph, because it is derived from it and a rebuild
    replaces the source outright. `apply_scores_from_db` drops the cache when
    it rewrites the scores, so the collapsed copy cannot outlive the figures it
    aggregated.
    """
    cached = G.graph.get("_entity_view")
    if cached is not None:
        return cached
    view = collapse_to_entities(G)
    G.graph["_entity_view"] = view
    return view


def _resolve_view(group: Optional[str]) -> Optional[nx.Graph]:
    """The graph a request asked for: addresses, or the actors behind them."""
    G = _resolve_graph()
    if G is None:
        return None
    return _entity_view(G) if group == "entity" else G


def _view_for_id(node_id: str, group: Optional[str]) -> Optional[nx.Graph]:
    """
    The graph an id belongs to.

    A synthetic entity id only exists in the collapsed view, so a link to one
    resolves there whatever mode the caller thinks it is in — that is what lets
    an entity be opened from a bookmark or a note.
    """
    return _resolve_view("entity" if is_entity_node_id(node_id) else group)


def _empty_payload(reason: str) -> dict:
    return {
        "nodes": [], "edges": [], "clusters": {},
        "stats": {"total_nodes": 0, "total_edges": 0, "cluster_count": 0},
        "ready": False,
        "reason": reason,
    }


def _flows(G: nx.Graph, entity_id: str, other: str, edge: dict):
    """
    (direction, amount) for one link, from `entity_id`'s point of view.

    'out'  — this entity paid into the transaction
    'in'   — the transaction paid this entity
    'none' — a co-input inference or an IP observation, where no value moved

    A change address funds a transaction *and* takes change back from it, so
    one edge can yield both.
    """
    edge_type = edge.get("edge_type", "unknown")
    if edge_type not in ("wallet_input", "wallet_output", "wallet_change"):
        return [("none", edge.get("amount"))]

    entity_is_tx = G.nodes[entity_id].get("node_type") == "transaction"
    spent = edge.get("spent")
    received = edge.get("received")

    if spent is None and received is None:
        # Pre-split graph: the single amount and the recorded type are all
        # there is to go on.
        amount = edge.get("amount")
        outward = (edge_type == "wallet_input") != entity_is_tx
        return [("out" if outward else "in", amount)]

    out = []
    if spent is not None:
        # The wallet spending into the transaction: out of the wallet, in to
        # the transaction.
        out.append(("in" if entity_is_tx else "out", spent))
    if received is not None:
        out.append(("out" if entity_is_tx else "in", received))
    return out


@router.get("/data")
def get_graph_data(
    layout: str = "spring",
    max_nodes: int = Query(1500, ge=1, le=20_000,
                           description="Cap on nodes returned; the renderer stalls well before the upper bound."),
    node_type: Optional[str] = None,
    min_score: float = 0.0,
    group: Optional[str] = Query(
        None,
        description="'entity' collapses co-spending addresses into one node per "
                    "actor. Anything else returns the address-level graph."),
):
    """Get full graph data for visualization."""
    G = _resolve_view(group)
    if G is None:
        return _empty_payload(
            "No data ingested yet. Run the pipeline from the Ingest page."
            if _tx_count() == 0 else
            "The entity graph could not be built from the ingested data."
        )

    # Filtering keeps each match's neighbourhood, so the result stays a
    # connected graph rather than a set of isolated points.
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
    payload["grouped"] = "entity" if group == "entity" else "address"
    payload["entity_summary"] = G.graph.get("entity_summary")
    return payload


@router.get("/subgraph/{entity_id:path}")
def get_entity_subgraph(entity_id: str,
                        hops: int = Query(2, ge=1, le=6,
                                          description="Traversal depth. Each hop multiplies the frontier, so this is bounded."),
                        layout: str = "spring",
                        max_nodes: int = Query(600, ge=1, le=20_000),
                        group: Optional[str] = None):
    """Get N-hop subgraph around a specific entity."""
    G = _view_for_id(entity_id, group)
    if G is None:
        return _empty_payload("No data ingested yet.")
    if entity_id not in G:
        return _empty_payload(f"'{entity_id}' is not present in the current graph.")

    sub = get_subgraph(G, entity_id, hops=hops)
    payload = graph_to_json(sub, layout=layout, max_nodes=max_nodes).model_dump()
    payload["ready"] = True
    payload["focus"] = entity_id
    payload["grouped"] = "entity" if G.graph.get("grouped") == "entity" else "address"
    return payload


@router.get("/neighbors/{entity_id:path}")
def expand_entity(entity_id: str, limit: int = Query(60, ge=1, le=5_000),
                  group: Optional[str] = None):
    """
    One hop out from a node, as a nodes+edges fragment the client merges into
    the graph it already holds rather than replacing it.
    """
    G = _view_for_id(entity_id, group)
    if G is None or entity_id not in G:
        return {"nodes": [], "edges": [], "truncated": False, "total_neighbors": 0}

    neighbors = list(G.neighbors(entity_id))
    total = len(neighbors)
    # Highest-degree neighbours first: those connect onward.
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
        members = data.get("entity_size") or 1
        nodes.append({
            "id": node_id,
            "label": _node_label(node_id, data),
            "node_type": node_type,
            "size": _node_size(node_type, degree, score, members),
            "color": RISK_COLORS.get(tier) or NODE_COLORS.get(node_type, "#5C6473"),
            "cluster_id": data.get("cluster_id"),
            "risk_tier": tier if tier != "Normal" else None,
            "anomaly_score": score if score > 0 else None,
            "metadata": {"degree": degree, "entity_size": members},
        })

    # Through the serializer, so an expanded fragment carries the same
    # directions as the graph it is merged into. Built by hand here, it
    # emitted whatever order the adjacency held and a spend and a receipt
    # arrived indistinguishable.
    edges = [e.model_dump() for e in _serialize_edges(sub)]

    return {
        "nodes": nodes,
        "edges": edges,
        "truncated": total > limit,
        "total_neighbors": total,
    }


@router.get("/path")
def find_path(source: str, target: str, max_hops: int = Query(8, ge=1, le=20),
              group: Optional[str] = None):
    """Shortest connection between two entities, with the edge type per hop."""
    G = _view_for_id(source, group)
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
def node_detail(entity_id: str, group: Optional[str] = None):
    """
    Full record for one entity: graph position, behavioural features, alerts
    raised against it, and its strongest counterparties.
    """
    G = _view_for_id(entity_id, group)
    if G is None:
        return {
            "found": False, "id": entity_id,
            "reason": "no_graph",
            "detail": ("There is no entity graph loaded — the database holds no "
                       "transactions. Any graph still on screen was drawn from an "
                       "earlier session; reload the page after ingesting data."),
        }
    if entity_id not in G:
        return {
            "found": False, "id": entity_id,
            "reason": "not_in_graph",
            "detail": ("This entity is not in the graph the backend currently "
                       "holds. The graph on screen was loaded before the dataset "
                       "changed; reload it to resynchronise."),
        }

    data = dict(G.nodes[entity_id])
    node_type = data.get("node_type", "unknown")
    neighbors = list(G.neighbors(entity_id))

    # Every address this actor is known to control. The node itself carries a
    # capped sample so the graph payload stays small; the full membership is
    # what the panel needs, and it comes from the index.
    entity_members: list[str] = []
    if node_type == "entity":
        index = G.graph.get("entities")
        base = entity_id_from_node(entity_id)
        entity_members = sorted(
            index.members.get(base, data.get("members") or [base]) if index
            else (data.get("members") or [base])
        )

    neighbor_types: dict[str, int] = {}
    for n in neighbors:
        nt = G.nodes[n].get("node_type", "unknown")
        neighbor_types[nt] = neighbor_types.get(nt, 0) + 1

    # Highest-degree links first, each labelled with which way value moved.
    # Without a direction the panel listed a wallet's transactions as an
    # undifferentiated set, and the one question an investigator opens it to
    # answer — what came in, what went out — could not be read off it.
    counterparties = []
    for n in sorted(neighbors, key=lambda x: -G.degree(x))[:8]:
        edge = G.get_edge_data(entity_id, n) or {}
        for direction, amount in _flows(G, entity_id, n, edge):
            counterparties.append({
                "id": n,
                "node_type": G.nodes[n].get("node_type", "unknown"),
                "edge_type": edge.get("edge_type", "unknown"),
                "direction": direction,
                "amount": amount,
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

    if node_type == "entity":
        detail["entity_size"] = len(entity_members)
        # Capped at what a panel can show; the count above is the real figure.
        detail["members"] = entity_members[:500]
        detail["members_truncated"] = len(entity_members) > 500
        detail["cospend_witnesses"] = data.get("cospend_witnesses") or []

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

            elif node_type == "entity" and entity_members:
                # One actor's behaviour is its addresses' behaviour added up —
                # except risk, which is the worst of them: an entity is as
                # compromised as its most compromised address.
                placeholders = ",".join("?" * len(entity_members))
                rows = con.execute(f"""
                    SELECT address, tx_count, total_received, total_sent,
                           anomaly_score, risk_tier, first_seen, last_seen,
                           mixer_interaction_count, darknet_proximity_hops
                    FROM wallet_features WHERE address IN ({placeholders})
                """, entity_members).fetchall()
                if rows:
                    scored = sorted(rows, key=lambda r: -(r[4] or 0.0))
                    hops = [r[9] for r in rows if r[9] is not None]
                    detail["features"] = {
                        "address_count": len(entity_members),
                        "scored_addresses": len(rows),
                        "tx_count": sum(r[1] or 0 for r in rows),
                        "total_received": round(sum(r[2] or 0.0 for r in rows), 8),
                        "total_sent": round(sum(r[3] or 0.0 for r in rows), 8),
                        "anomaly_score": scored[0][4],
                        "risk_tier": scored[0][5],
                        "worst_address": scored[0][0],
                        "first_seen": str(min((r[6] for r in rows if r[6]), default="")) or None,
                        "last_seen": str(max((r[7] for r in rows if r[7]), default="")) or None,
                        "mixer_interaction_count": sum(r[8] or 0 for r in rows),
                        "darknet_proximity_hops": min(hops) if hops else None,
                    }
                    detail["risk_tier"] = scored[0][5] or detail["risk_tier"]
                    if scored[0][4]:
                        detail["anomaly_score"] = scored[0][4]
                    detail["member_scores"] = [
                        {"address": r[0], "anomaly_score": r[4], "risk_tier": r[5]}
                        for r in scored[:25]
                    ]

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

            # An alert is raised against an address. Opening the actor must
            # surface what was raised against any of its addresses, or an
            # entity would read as clean while one of its members is flagged.
            alert_targets = entity_members if node_type == "entity" else [entity_id]
            placeholders = ",".join("?" * len(alert_targets))
            alert_rows = con.execute(f"""
                SELECT alert_id, risk_tier, confidence, model, description, status,
                       evidence_confidence, evidence_rationale
                FROM alerts WHERE entity_id IN ({placeholders})
                ORDER BY confidence DESC LIMIT 5
            """, alert_targets).fetchall()
            detail["alerts"] = [
                {"alert_id": a[0], "risk_tier": a[1],
                 "risk_score": a[2], "confidence": a[2],
                 "model": a[3], "description": a[4], "status": a[5],
                 "evidence_confidence": a[6], "evidence_rationale": a[7]}
                for a in alert_rows
            ]
    except Exception as exc:
        # Reported, not swallowed: without this the panel showed an entity
        # with no features and no alerts, which is exactly what a genuinely
        # unremarkable wallet looks like.
        logger.exception("node_detail enrichment failed for %s", entity_id)
        detail["enrichment_error"] = f"{type(exc).__name__}: {exc}"

    # The same record in sentences, for a reader who does not already know
    # what fan-in degree or a round-amount ratio is. Derived from `detail`
    # itself, so it cannot drift from the figures beside it.
    try:
        from app.graph.explain import explain_entity
        detail["summary"] = explain_entity(detail)
    except Exception:
        logger.exception("summary generation failed for %s", entity_id)
        detail["summary"] = None

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
def search_graph(q: str = "", limit: int = Query(20, ge=1, le=500),
                 node_type: Optional[str] = None,
                 group: Optional[str] = None):
    """
    Substring search over entity ids, ranked exact -> prefix -> substring,
    then by risk score and degree.

    In the collapsed view an address that belongs to a multi-address actor is
    no longer a node of its own, so searching for it has to find the actor
    holding it — otherwise pasting an address from a case file into the find
    box returns nothing on the very view that was meant to make it findable.
    """
    G = _resolve_view(group)
    if not G or not q:
        return []

    q_lower = q.lower()
    scored = []

    index = G.graph.get("entities") if group == "entity" else None
    member_hits: dict[str, str] = {}
    if index:
        for address, entity in index.entity_of.items():
            if q_lower in address.lower() and len(index.members.get(entity, ())) > 1:
                node = f"entity:{entity}"
                # First match wins: the list is ranked below, and one row per
                # actor is what the operator can act on.
                member_hits.setdefault(node, address)

    for node, data in G.nodes(data=True):
        if node_type and data.get("node_type") != node_type:
            continue
        node_lower = node.lower()
        matched_member = member_hits.pop(node, None)
        if q_lower not in node_lower and not matched_member:
            continue
        if matched_member and q_lower not in node_lower:
            # Ranked as a substring hit: it matched an address inside the
            # actor rather than the actor's own name.
            scored.append((
                2,
                -(data.get("anomaly_score") or 0.0),
                -G.degree(node),
                node,
                {**data, "matched_address": matched_member},
            ))
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
            "label": _node_label(node, data),
            "node_type": data.get("node_type", "unknown"),
            "risk_tier": data.get("risk_tier"),
            "anomaly_score": data.get("anomaly_score"),
            "degree": G.degree(node),
            "entity_size": data.get("entity_size") or 1,
            # Set when the query matched an address this actor holds rather
            # than the address it is named after, so the row can say so.
            "matched_address": data.get("matched_address"),
        }
        for _, _, _, node, data in scored[:limit]
    ]
