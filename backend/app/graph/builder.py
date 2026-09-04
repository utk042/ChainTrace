"""
ChainTrace Forensics — Entity Graph Builder
Constructs a NetworkX multi-graph linking IPs, Wallets, and Transactions.
"""

import networkx as nx
import duckdb
from typing import Optional
from app.database import get_db_readonly


def build_entity_graph(con: duckdb.DuckDBPyConnection = None) -> nx.Graph:
    """
    Build the full entity graph from DuckDB transaction data.

    Node types: 'wallet', 'ip', 'transaction'
    Edge types: 'ip_observed_tx', 'wallet_input', 'wallet_output', 'co_input'
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
                    G.add_edge(addr, txid, edge_type="wallet_input", amount=amt)

                # Co-input heuristic: wallets in the same TX inputs likely belong
                # to the same entity (common-input-ownership heuristic)
                if len(input_addrs) > 1:
                    for i in range(len(input_addrs)):
                        for j in range(i + 1, len(input_addrs)):
                            G.add_edge(input_addrs[i], input_addrs[j],
                                       edge_type="co_input", txid=txid)

            # Add wallet output nodes and edges
            if output_addrs:
                for i, addr in enumerate(output_addrs):
                    if not G.has_node(addr):
                        G.add_node(addr, node_type="wallet", tx_count=0,
                                   total_sent=0.0, total_received=0.0)
                    G.nodes[addr]["tx_count"] = G.nodes[addr].get("tx_count", 0) + 1
                    amt = output_amts[i] if i < len(output_amts) else 0.0
                    G.nodes[addr]["total_received"] = G.nodes[addr].get("total_received", 0.0) + amt
                    G.add_edge(txid, addr, edge_type="wallet_output", amount=amt)

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
        print(f"⚠ Could not read wallet_features to score the graph: {e}")
        return 0
    finally:
        if own_connection:
            ctx.__exit__(None, None, None)

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
