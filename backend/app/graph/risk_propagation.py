"""
ChainTrace Forensics — Risk Propagation from Seed (Known-Illicit) Wallets
Section 4 "Risk Scoring": propagate risk scores from seed illicit wallets
via an algorithm — a breadth-first hop-distance walk with exponential
decay, seeded from the operator's own watchlist (app/routers/settings.py
seed-wallets endpoints — ChainTrace never invents which wallets are
illicit; that's an investigative judgment call, not something to fabricate).
"""

from collections import deque
import networkx as nx


def propagate_risk(
    G: nx.Graph,
    seed_wallets: set[str],
    max_hops: int = 3,
    decay: float = 0.5,
) -> dict[str, dict]:
    """
    BFS outward from `seed_wallets` over the entity graph, walking through
    transaction nodes to reach every wallet within `max_hops` of a seed
    (wallet<->wallet edges alone would miss most connections — most
    wallets are only linked to each other via a shared transaction, not a
    direct co_input edge).

    Returns {wallet_address: {"darknet_proximity_hops": int,
                               "darknet_proximity_score": float}}
    for every wallet reached, seeds included (hop 0, score 1.0). A wallet
    not reachable within max_hops from any seed is simply absent — it has
    no known proximity to flagged addresses, not a zero-ed-out guess.
    """
    seeds_in_graph = {w for w in seed_wallets if w in G}
    if not seeds_in_graph:
        return {}

    hops: dict[str, int] = {w: 0 for w in seeds_in_graph}
    frontier = deque(seeds_in_graph)

    while frontier:
        node = frontier.popleft()
        hop = hops[node]
        if hop >= max_hops:
            continue

        for neighbor in G.neighbors(node):
            ndata = G.nodes[neighbor]
            reachable_wallets = set()
            if ndata.get("node_type") == "wallet":
                reachable_wallets.add(neighbor)
            elif ndata.get("node_type") == "transaction":
                # Step through the transaction to the wallets on its other side.
                for w2 in G.neighbors(neighbor):
                    if G.nodes[w2].get("node_type") == "wallet":
                        reachable_wallets.add(w2)

            for w2 in reachable_wallets:
                if w2 not in hops:
                    hops[w2] = hop + 1
                    frontier.append(w2)

    return {
        addr: {
            "darknet_proximity_hops": hop,
            "darknet_proximity_score": round(decay ** hop, 4),
        }
        for addr, hop in hops.items()
    }
