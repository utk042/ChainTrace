"""
ChainTrace Forensics — Entity Graph Builder
Constructs a NetworkX multi-graph linking IPs, Wallets, and Transactions.
"""

import networkx as nx
import duckdb
from typing import Optional
from app.database import get_db_readonly
from app.graph.entities import EntityIndex, build_entity_index

from app.logging_config import get_logger

logger = get_logger("app.graph.builder")


def _link_wallet_tx(G: nx.Graph, address: str, txid: str,
                    spent: float = None, received: float = None) -> None:
    """
    Record one direction of a wallet's involvement in a transaction.

    The entity graph is undirected — Louvain clustering, the embeddings and
    risk propagation all need it that way — so `add_edge(addr, txid)` and
    `add_edge(txid, addr)` are the same edge and the second call overwrites
    the first's attributes. That silently destroyed the most basic fact about
    a wallet: whether money went in or out. A change address, which appears
    as both an input and an output of the same transaction, kept only
    whichever role was written last, and every other wallet-to-transaction
    edge carried a direction that depended on iteration order rather than on
    the payment.

    Both amounts are kept on the one edge instead. `spent` is the wallet
    paying into the transaction, `received` is the transaction paying out to
    it; a change address has both. The serializer turns each present amount
    into its own directed edge for the client, so a wallet that funded a
    transaction and took change back is drawn as the two flows it is.
    """
    data = G.get_edge_data(address, txid)
    if data is None:
        G.add_edge(address, txid, edge_type="wallet_input" if spent is not None
                   else "wallet_output")
        data = G.get_edge_data(address, txid)

    if spent is not None:
        data["spent"] = round(data.get("spent", 0.0) + spent, 8)
    if received is not None:
        data["received"] = round(data.get("received", 0.0) + received, 8)

    has_spent = data.get("spent") is not None
    has_received = data.get("received") is not None
    if has_spent and has_received:
        data["edge_type"] = "wallet_change"
    elif has_spent:
        data["edge_type"] = "wallet_input"
    else:
        data["edge_type"] = "wallet_output"

    # `amount` predates the split and several callers still read it; keep it
    # as the larger of the two so nothing that used it regresses to zero.
    data["amount"] = max(data.get("spent") or 0.0, data.get("received") or 0.0)


def _label_entities(G: nx.Graph, entities: EntityIndex) -> None:
    """
    Stamp each wallet with the actor it belongs to, and keep the index on the
    graph so clustering and the entity view do not have to recompute it.
    """
    for node_id, data in G.nodes(data=True):
        if data.get("node_type") != "wallet":
            continue
        entity_id = entities.entity(node_id)
        data["entity_id"] = entity_id
        data["entity_size"] = entities.size(node_id)

    G.graph["entities"] = entities
    G.graph["entity_summary"] = entities.summary()


ENTITY_PREFIX = "entity:"


def entity_node_id(entity_id: str, size: int) -> str:
    """
    What a collapsed actor is called on the canvas.

    An actor holding one address *is* that address, and calling it anything
    else would make the commonest node on screen unsearchable and unlinkable.
    Only a genuine multi-address entity gets a synthetic id, and it carries the
    address it is named after so it still reads as somewhere on the chain.
    """
    return f"{ENTITY_PREFIX}{entity_id}" if size > 1 else entity_id


def is_entity_node_id(node_id: str) -> bool:
    return isinstance(node_id, str) and node_id.startswith(ENTITY_PREFIX)


def entity_id_from_node(node_id: str) -> str:
    return node_id[len(ENTITY_PREFIX):] if is_entity_node_id(node_id) else node_id


def collapse_to_entities(G: nx.Graph) -> nx.Graph:
    """
    The same graph with every co-spending group drawn as the one actor it is.

    A 120-input consolidation stops being 120 tiles joined by 7,140 inferred
    links and becomes what an investigator actually wants to see: one entity,
    one arrow into the transaction, one arrow out to whoever was paid. Nothing
    is discarded — the member addresses ride along on the node, and the flows
    are summed rather than dropped, so the amounts still add up.

    Transactions and IPs are untouched. Only wallets are collapsed, because
    only wallets have an ownership heuristic behind them.
    """
    entities: EntityIndex | None = G.graph.get("entities")
    C = nx.Graph()

    def target_of(node_id: str) -> str:
        data = G.nodes[node_id]
        if data.get("node_type") != "wallet":
            return node_id
        entity_id = data.get("entity_id") or (
            entities.entity(node_id) if entities else node_id)
        size = data.get("entity_size") or (entities.size(node_id) if entities else 1)
        return entity_node_id(entity_id, size)

    # ── Nodes ──────────────────────────────────────────────────────
    for node_id, data in G.nodes(data=True):
        key = target_of(node_id)
        if data.get("node_type") != "wallet":
            if not C.has_node(key):
                C.add_node(key, **data)
            continue

        if not C.has_node(key):
            entity_id = data.get("entity_id") or node_id
            members = entities.members.get(entity_id, [node_id]) if entities else [node_id]
            is_group = len(members) > 1
            C.add_node(key, **{
                "node_type": "entity" if is_group else "wallet",
                "entity_id": entity_id,
                "entity_size": len(members),
                # Capped: an entity of 4,000 addresses must not put 4,000
                # strings into every graph payload. The detail endpoint serves
                # the full membership when one is actually opened.
                "members": sorted(members)[:50],
                "cospend_witnesses": entities.witnesses(entity_id) if entities and is_group else [],
                "tx_count": 0,
                "total_sent": 0.0,
                "total_received": 0.0,
                "anomaly_score": 0.0,
                "risk_tier": "Normal",
            })

        # Aggregate the members. The actor's totals are its addresses' totals;
        # its risk is the worst of them, because an entity is as compromised as
        # its most compromised address.
        node = C.nodes[key]
        node["tx_count"] = node.get("tx_count", 0) + (data.get("tx_count") or 0)
        node["total_sent"] = round(node.get("total_sent", 0.0) + (data.get("total_sent") or 0.0), 8)
        node["total_received"] = round(
            node.get("total_received", 0.0) + (data.get("total_received") or 0.0), 8)
        score = data.get("anomaly_score") or 0.0
        if score >= (node.get("anomaly_score") or 0.0):
            node["anomaly_score"] = score
            node["risk_tier"] = data.get("risk_tier") or node.get("risk_tier") or "Normal"
        if node.get("cluster_id") is None and data.get("cluster_id") is not None:
            node["cluster_id"] = data.get("cluster_id")

    # ── Edges ──────────────────────────────────────────────────────
    for u, v, data in G.edges(data=True):
        a, b = target_of(u), target_of(v)
        if a == b:
            # Both endpoints collapsed into the same actor. A self-loop would
            # draw as a smudge and say nothing the entity node does not.
            continue
        existing = C.get_edge_data(a, b)
        if existing is None:
            C.add_edge(a, b, **{k: v2 for k, v2 in data.items()})
            continue
        # Two members of one entity funding the same transaction merge into a
        # single arrow whose amount is what the actor actually moved.
        for field in ("spent", "received", "amount"):
            value = data.get(field)
            if value is None:
                continue
            existing[field] = round((existing.get(field) or 0.0) + value, 8)
        if existing.get("spent") and existing.get("received"):
            existing["edge_type"] = "wallet_change"

    C.graph["entities"] = entities
    C.graph["entity_summary"] = G.graph.get("entity_summary")
    C.graph["grouped"] = "entity"
    return C


def build_entity_graph(con: duckdb.DuckDBPyConnection = None) -> nx.Graph:
    """
    Build the full entity graph from DuckDB transaction data.

    Node types: 'wallet', 'ip', 'transaction'
    Edge types: 'ip_observed_tx', 'wallet_input', 'wallet_output'

    Common-input-ownership is carried as a partition — `entity_id` on each
    wallet node, and the whole index on `G.graph["entities"]` — rather than as
    an edge between every pair of co-spending addresses. See app/graph/
    entities.py for why: the pairwise form restated one observation about 120
    addresses as 7,140 links, which is what made a 500-transaction pull from
    the live chain unreadable.
    """
    own_connection = con is None
    if own_connection:
        ctx = get_db_readonly()
        con = ctx.__enter__()

    try:
        G = nx.Graph()

        # Fetch all transactions
        rows = con.execute("""
            SELECT txid, timestamp, src_ip, dst_ip,
                   input_addresses, output_addresses,
                   input_amounts, output_amounts, fee
            FROM transactions
        """).fetchall()

        # Who owns what, worked out before anything is drawn. Union-find over
        # the input sets, so a co-spend of 120 addresses costs 120 operations
        # rather than the 7,140 edges it used to add to the canvas.
        entities = build_entity_index((r[4], r[5], r[0]) for r in rows)

        for row in rows:
            txid, timestamp, src_ip, dst_ip, \
                input_addrs, output_addrs, \
                input_amts, output_amts, fee = row

            # Add transaction node
            total_in = sum(input_amts) if input_amts else 0
            total_out = sum(output_amts) if output_amts else 0
            G.add_node(txid, node_type="transaction", timestamp=str(timestamp),
                       total_input=total_in, total_output=total_out, fee=fee)

            # Add IP nodes and edges
            for ip in set([src_ip, dst_ip]):
                if ip:
                    if not G.has_node(ip):
                        G.add_node(ip, node_type="ip", hit_count=0)
                    G.nodes[ip]["hit_count"] = G.nodes[ip].get("hit_count", 0) + 1
                    G.add_edge(ip, txid, edge_type="ip_observed_tx")

            # Add wallet input nodes and edges
            if input_addrs:
                for i, addr in enumerate(input_addrs):
                    if not G.has_node(addr):
                        G.add_node(addr, node_type="wallet", tx_count=0,
                                   total_sent=0.0, total_received=0.0)
                    G.nodes[addr]["tx_count"] = G.nodes[addr].get("tx_count", 0) + 1
                    amt = input_amts[i] if i < len(input_amts) else 0.0
                    G.nodes[addr]["total_sent"] = G.nodes[addr].get("total_sent", 0.0) + amt
                    _link_wallet_tx(G, addr, txid, spent=amt)

            # Add wallet output nodes and edges
            if output_addrs:
                for i, addr in enumerate(output_addrs):
                    if not G.has_node(addr):
                        G.add_node(addr, node_type="wallet", tx_count=0,
                                   total_sent=0.0, total_received=0.0)
                    G.nodes[addr]["tx_count"] = G.nodes[addr].get("tx_count", 0) + 1
                    amt = output_amts[i] if i < len(output_amts) else 0.0
                    G.nodes[addr]["total_received"] = G.nodes[addr].get("total_received", 0.0) + amt
                    _link_wallet_tx(G, addr, txid, received=amt)

        _label_entities(G, entities)
        return G

    finally:
        if own_connection:
            ctx.__exit__(None, None, None)


def apply_scores_from_db(G: nx.Graph, con: duckdb.DuckDBPyConnection = None) -> int:
    """
    Copy anomaly scores, risk tiers and cluster ids from `wallet_features`
    onto an already-built graph. Returns the number of nodes updated.

    build_entity_graph() reads the transactions table only, so a graph rebuilt
    outside a pipeline run carries no scores until this runs.
    """
    own_connection = con is None
    if own_connection:
        ctx = get_db_readonly()
        con = ctx.__enter__()

    try:
        rows = con.execute(
            "SELECT address, anomaly_score, risk_tier, cluster_id FROM wallet_features"
        ).fetchall()
    except Exception as e:
        logger.warning(f"Could not read wallet_features to score the graph: {e}")
        return 0
    finally:
        if own_connection:
            ctx.__exit__(None, None, None)

    # Any collapsed copy of this graph aggregated the scores that are about to
    # be replaced, so it is no longer a view of it.
    G.graph.pop("_entity_view", None)

    updated = 0
    for address, score, tier, cluster_id in rows:
        if address not in G:
            continue
        G.nodes[address]["anomaly_score"] = score or 0.0
        G.nodes[address]["risk_tier"] = tier or "Normal"
        if cluster_id is not None:
            G.nodes[address]["cluster_id"] = cluster_id
        updated += 1

    return updated


def get_subgraph(G: nx.Graph, entity_id: str, hops: int = 2) -> nx.Graph:
    """Extract N-hop ego subgraph around an entity."""
    if entity_id not in G:
        return nx.Graph()

    # Get N-hop neighborhood
    nodes = set([entity_id])
    frontier = set([entity_id])

    for _ in range(hops):
        next_frontier = set()
        for node in frontier:
            for neighbor in G.neighbors(node):
                if neighbor not in nodes:
                    next_frontier.add(neighbor)
                    nodes.add(neighbor)
        frontier = next_frontier

    return G.subgraph(nodes).copy()


def get_graph_stats(G: nx.Graph) -> dict:
    """Compute summary statistics for the graph."""
    node_types = {}
    for _, data in G.nodes(data=True):
        nt = data.get("node_type", "unknown")
        node_types[nt] = node_types.get(nt, 0) + 1

    edge_types = {}
    for _, _, data in G.edges(data=True):
        et = data.get("edge_type", "unknown")
        edge_types[et] = edge_types.get(et, 0) + 1

    return {
        "total_nodes": G.number_of_nodes(),
        "total_edges": G.number_of_edges(),
        "node_types": node_types,
        "edge_types": edge_types,
        "density": nx.density(G) if G.number_of_nodes() > 1 else 0,
        "connected_components": nx.number_connected_components(G),
    }
