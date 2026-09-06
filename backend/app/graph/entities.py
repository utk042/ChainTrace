"""
ChainTrace Forensics — Wallet Entities (common-input-ownership)

The common-input-ownership heuristic says that every address funding a single
transaction is controlled by whoever signed it. That is one fact about a set of
addresses, and it is *transitive*: if A and B are spent together, and B and C
are spent together, then A, B and C are one actor.

It used to be recorded as a clique — an edge between every pair of co-spending
addresses. A transaction with 174 inputs therefore contributed 15,051 edges on
its own, and a modest 500-transaction pull from the live chain arrived carrying
28,016 links, almost all of them restatements of a few dozen observations. Three
things went wrong with that:

  * The canvas became an unreadable mat. The addresses were legible; nothing
    between them was, and the structure the graph exists to show was the thing
    hidden.
  * Every degree-derived figure was inflated. Node size, the "Connections"
    count in the inspector, the ordering of neighbours and of search results
    all read a single co-spend of 120 inputs as 119 separate relationships.
  * Louvain, run over a graph dominated by those cliques, mostly rediscovered
    them — an expensive way to be told what union-find already knows exactly.

So the relation is stored as what it is: a partition. Union-find over the input
sets gives each address an entity, in near-linear time, and the pairwise edges
are not drawn at all — two addresses spent together are still one hop apart
through the transaction that spent them, so nothing becomes unreachable.
"""

from __future__ import annotations

from app.logging_config import get_logger

logger = get_logger("app.graph.entities")


class UnionFind:
    """Disjoint-set over address strings, with path compression by rank."""

    def __init__(self) -> None:
        self._parent: dict[str, str] = {}
        self._rank: dict[str, int] = {}

    def add(self, item: str) -> None:
        if item not in self._parent:
            self._parent[item] = item
            self._rank[item] = 0

    def find(self, item: str) -> str:
        self.add(item)
        root = item
        while self._parent[root] != root:
            root = self._parent[root]
        # Path compression, iteratively: an exchange consolidation can chain
        # deeply enough to matter, and recursion here would risk the stack.
        while self._parent[item] != root:
            self._parent[item], item = root, self._parent[item]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self._rank[ra] < self._rank[rb]:
            ra, rb = rb, ra
        self._parent[rb] = ra
        if self._rank[ra] == self._rank[rb]:
            self._rank[ra] += 1

    def groups(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for item in self._parent:
            out.setdefault(self.find(item), []).append(item)
        return out


class EntityIndex:
    """
    Which addresses belong to which actor, and what witnessed each grouping.

    `entity_of` maps an address to its entity id. The id is the
    lexicographically smallest member address, so it is stable across runs and
    across machines — a sequential counter would renumber every entity whenever
    a dataset was re-ingested in a different order, and an investigator's notes
    would stop matching what is on screen.
    """

    def __init__(self) -> None:
        self._uf = UnionFind()
        # entity root -> the txids whose inputs merged it. Capped: the evidence
        # an operator needs is "which spend proved this", not all of them.
        self._witness: dict[str, set[str]] = {}
        self.entity_of: dict[str, str] = {}
        self.members: dict[str, list[str]] = {}

    def observe_cospend(self, addresses, txid: str | None = None) -> None:
        """Record that these addresses funded one transaction together."""
        addresses = [a for a in (addresses or []) if a]
        if not addresses:
            return
        first = addresses[0]
        self._uf.add(first)
        for other in addresses[1:]:
            self._uf.union(first, other)
        if txid and len(addresses) > 1:
            self._witness.setdefault(first, set()).add(txid)

    def add_address(self, address: str) -> None:
        """An address seen on its own is an entity of one."""
        if address:
            self._uf.add(address)

    def finalise(self) -> "EntityIndex":
        """Freeze the partition into stable ids. Call once, after every spend."""
        witness_by_root: dict[str, set[str]] = {}
        for seed, txids in self._witness.items():
            witness_by_root.setdefault(self._uf.find(seed), set()).update(txids)

        for root, group in self._uf.groups().items():
            group.sort()
            entity_id = group[0]
            self.members[entity_id] = group
            for address in group:
                self.entity_of[address] = entity_id
            self._witness[entity_id] = witness_by_root.get(root, set())

        # Roots that are no longer entity ids would otherwise linger.
        self._witness = {k: v for k, v in self._witness.items() if k in self.members}
        return self

    # ── Reading it back ────────────────────────────────────────────
    def entity(self, address: str) -> str:
        return self.entity_of.get(address, address)

    def size(self, address: str) -> int:
        return len(self.members.get(self.entity(address), (address,)))

    def witnesses(self, entity_id: str, limit: int = 12) -> list[str]:
        return sorted(self._witness.get(entity_id, ()))[:limit]

    @property
    def multi_address_count(self) -> int:
        return sum(1 for m in self.members.values() if len(m) > 1)

    def summary(self) -> dict:
        sizes = [len(m) for m in self.members.values()]
        return {
            "addresses": sum(sizes),
            "entities": len(sizes),
            "multi_address_entities": self.multi_address_count,
            "largest_entity": max(sizes) if sizes else 0,
        }


def build_entity_index(rows) -> EntityIndex:
    """
    Partition addresses into entities from `(input_addresses, output_addresses,
    txid)` triples.

    Outputs are added but never merged: being paid by the same transaction says
    nothing about common ownership, and treating it as if it did would fuse
    every recipient of an exchange payout batch into one actor.
    """
    index = EntityIndex()
    for input_addrs, output_addrs, txid in rows:
        index.observe_cospend(input_addrs, txid)
        for address in output_addrs or ():
            index.add_address(address)
    return index.finalise()
