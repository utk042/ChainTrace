"""
Common-input-ownership, as a partition rather than a clique.

Run: python tests/entities.py

The clique form is what made a 500-transaction pull from the live chain
unreadable — a 224-input consolidation alone contributed 24,976 links, all of
them restatements of one observation. These cases pin the properties that
replaced it:

  * co-spending is transitive, so A-B and B-C put A, B and C in one entity;
  * being paid by the same transaction is *not* co-spending, and must never
    merge anyone (an exchange payout batch would otherwise fuse every
    recipient into a single actor);
  * entity ids are stable across ingestion order, or an investigator's notes
    stop matching the screen after a re-ingest;
  * collapsing the graph preserves the amounts and drops no counterparty.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import networkx as nx  # noqa: E402

from app.graph.entities import build_entity_index, UnionFind  # noqa: E402
from app.graph.builder import collapse_to_entities, _label_entities  # noqa: E402

failures = []


def check(ok, label, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail else ''}")
    if not ok:
        failures.append(label)


# ── The partition ──────────────────────────────────────────────────
uf = UnionFind()
uf.union("a", "b")
uf.union("b", "c")
uf.union("d", "e")
groups = {frozenset(g) for g in uf.groups().values()}
check(groups == {frozenset("abc"), frozenset("de")},
      "co-spending is transitive", str(sorted(map(sorted, groups))))

# A chain long enough that a recursive find would be a liability.
deep = UnionFind()
for i in range(20_000):
    deep.union(f"a{i}", f"a{i + 1}")
check(len(deep.groups()) == 1, "a 20,000-link chain resolves to one entity")

# ── Inputs merge, outputs never do ─────────────────────────────────
index = build_entity_index([
    (["a", "b"], ["x"], "tx1"),
    (["b", "c"], ["y"], "tx2"),
    # One transaction paying three addresses says nothing about ownership.
    ([], ["p", "q", "r"], "tx3"),
])
check(index.entity("a") == index.entity("c"),
      "addresses linked through a shared co-spend are one actor")
check(len({index.entity(n) for n in ("p", "q", "r")}) == 3,
      "being paid by one transaction does not merge anyone")
check(index.size("a") == 3, "entity size counts every member", str(index.size("a")))
check(index.entity("a") == "a",
      "the entity is named after its lexicographically smallest member",
      index.entity("a"))
check(sorted(index.witnesses(index.entity("a"))) == ["tx1", "tx2"],
      "the transactions that produced the grouping are kept as evidence")

# Stability: the same spends in a different order must produce the same ids.
shuffled = build_entity_index([
    ([], ["r", "q", "p"], "tx3"),
    (["c", "b"], ["y"], "tx2"),
    (["b", "a"], ["x"], "tx1"),
])
check(shuffled.entity_of == index.entity_of,
      "entity ids do not depend on ingestion order")

# ── Collapsing the graph ───────────────────────────────────────────
G = nx.Graph()
for w in ("a", "b", "c"):
    G.add_node(w, node_type="wallet", tx_count=1, total_sent=1.0, total_received=0.0,
               anomaly_score=0.0, risk_tier="Normal")
G.add_node("out", node_type="wallet", tx_count=1, total_sent=0.0, total_received=3.0,
           anomaly_score=90.0, risk_tier="Critical")
G.add_node("tx1", node_type="transaction")
G.add_node("1.2.3.4", node_type="ip")
for w in ("a", "b", "c"):
    G.add_edge(w, "tx1", edge_type="wallet_input", spent=1.0, amount=1.0)
G.add_edge("tx1", "out", edge_type="wallet_output", received=3.0, amount=3.0)
G.add_edge("1.2.3.4", "tx1", edge_type="ip_observed_tx")
_label_entities(G, build_entity_index([(["a", "b", "c"], ["out"], "tx1")]))

C = collapse_to_entities(G)
actors = [n for n, d in C.nodes(data=True) if d.get("node_type") == "entity"]
check(len(actors) == 1, "the co-spending group collapses to one actor", str(actors))
actor = C.nodes[actors[0]]
check(actor["entity_size"] == 3, "the actor knows how many addresses it holds")
check(actor["total_sent"] == 3.0, "member amounts are summed, not dropped",
      str(actor["total_sent"]))
check(C.get_edge_data(actors[0], "tx1")["spent"] == 3.0,
      "three input edges merge into one arrow carrying the whole amount")
check(C.has_node("out") and C.nodes["out"]["node_type"] == "wallet",
      "an address nobody co-spent with stays an address")
check(C.has_edge("1.2.3.4", "tx1"), "network observations are untouched")
check(C.number_of_edges() == 3, "no counterparty is lost", str(C.number_of_edges()))

# The worst member sets the actor's risk.
G.nodes["b"]["anomaly_score"] = 77.0
G.nodes["b"]["risk_tier"] = "High"
G.graph.pop("_entity_view", None)
C2 = collapse_to_entities(G)
check(C2.nodes[actors[0]]["risk_tier"] == "High",
      "an actor is as risky as its worst address",
      C2.nodes[actors[0]]["risk_tier"])

print()
if failures:
    print(f"{len(failures)} FAILURES:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
print("entities: all assertions passed")
