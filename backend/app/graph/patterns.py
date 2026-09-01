"""
ChainTrace Forensics — Laundering Pattern Detection
Explicit structural detectors for two well-documented Bitcoin laundering
techniques, rather than relying only on the generic autoencoder to
incidentally notice them:

- Peeling chain: a wallet holding a balance sends most of it onward to a
  new address (the "change"/continuation) and peels off a small amount to
  another address, repeatedly, hop after hop — the classic pattern used to
  slowly drain a large balance while making each individual transaction
  look unremarkable.
- CoinJoin-like mixing: a single transaction with several outputs of
  (near-)identical value drawn from multiple distinct inputs — the
  structural signature of a coordinated mix, regardless of which specific
  mixing service produced it.

Both feed:
  1. wallet-level features (peel_chain_depth, mixer_interaction_count) that
     the autoencoder and SHAP explainer can use like any other feature, and
  2. their own directly-labeled alerts in ml/trainer.py, so a wallet doing
     something structurally suspicious gets flagged even if its generic
     behavioral stats don't look unusual enough to trip the autoencoder.
"""

import duckdb


def detect_peeling_chains(con: duckdb.DuckDBPyConnection) -> dict[str, dict]:
    """
    Returns {wallet_address: {"peel_chain_depth": int, "peel_chain_role": str}}
    for every wallet that participates in at least one peel-shaped
    transaction. Depth is the length of the longest peel chain the wallet
    is part of; role is "chain" (depth >= 2, i.e. a genuine multi-hop
    chain) or "single_peel" (one isolated peel-shaped transaction).
    """
    rows = con.execute("""
        SELECT txid, timestamp, input_addresses, output_addresses, output_amounts
        FROM transactions
        ORDER BY timestamp
    """).fetchall()

    # A transaction is peel-shaped if it has exactly two outputs and one
    # dominates (>=80% of value) while the other is a small peel (<=20%).
    peel_txs = []
    for txid, ts, in_addrs, out_addrs, out_amts in rows:
        if not out_addrs or not out_amts or len(out_addrs) != 2 or len(out_amts) != 2:
            continue
        total = sum(out_amts)
        if total <= 0:
            continue
        ratio0 = out_amts[0] / total
        if max(ratio0, 1 - ratio0) < 0.80 or min(ratio0, 1 - ratio0) > 0.20:
            continue
        bulk_idx = 0 if out_amts[0] >= out_amts[1] else 1
        peel_idx = 1 - bulk_idx
        peel_txs.append({
            "txid": txid,
            "timestamp": ts,
            "inputs": set(in_addrs or []),
            "bulk_addr": out_addrs[bulk_idx],
            "peel_addr": out_addrs[peel_idx],
        })

    if not peel_txs:
        return {}

    # Index peel transactions by the address they consume, so we can walk
    # forward from one peel's "bulk" continuation into the next peel that
    # spends it — that's what turns isolated peels into a chain.
    by_input_addr: dict[str, list[dict]] = {}
    for pt in peel_txs:
        for addr in pt["inputs"]:
            by_input_addr.setdefault(addr, []).append(pt)

    depth_from: dict[str, int] = {}

    def chain_depth(pt: dict, _visiting: set) -> int:
        if pt["txid"] in depth_from:
            return depth_from[pt["txid"]]
        if pt["txid"] in _visiting:
            return 1  # guard against any accidental cycle
        _visiting.add(pt["txid"])

        best = 1
        for nxt in by_input_addr.get(pt["bulk_addr"], []):
            if nxt["timestamp"] > pt["timestamp"]:
                best = max(best, 1 + chain_depth(nxt, _visiting))

        _visiting.discard(pt["txid"])
        depth_from[pt["txid"]] = best
        return best

    for pt in peel_txs:
        chain_depth(pt, set())

    wallet_depth: dict[str, int] = {}
    for pt in peel_txs:
        depth = depth_from[pt["txid"]]
        for addr in pt["inputs"] | {pt["bulk_addr"], pt["peel_addr"]}:
            if depth > wallet_depth.get(addr, 0):
                wallet_depth[addr] = depth

    return {
        addr: {
            "peel_chain_depth": depth,
            "peel_chain_role": "chain" if depth >= 2 else "single_peel",
        }
        for addr, depth in wallet_depth.items()
    }


def detect_coinjoin_transactions(
    con: duckdb.DuckDBPyConnection,
    mixer_confidence_threshold: float = 0.85,
    value_tolerance: float = 0.01,
    min_equal_outputs: int = 3,
    min_distinct_inputs: int = 2,
) -> dict[str, dict]:
    """
    Returns {txid: {...}} for transactions structurally consistent with a
    CoinJoin-like mix: a cluster of `min_equal_outputs`+ outputs of
    (near-)identical value, drawn from `min_distinct_inputs`+ distinct
    input addresses. `mixer_confidence_threshold` (the Settings-page
    "Mixer Identification Confidence") controls how dominant that equal-
    value cluster must be relative to the transaction's total outputs
    before it counts.
    """
    rows = con.execute("""
        SELECT txid, input_addresses, output_addresses, output_amounts
        FROM transactions
    """).fetchall()

    result = {}
    for txid, in_addrs, out_addrs, out_amts in rows:
        if not out_amts or len(out_amts) < min_equal_outputs:
            continue

        sorted_amts = sorted(out_amts)
        best_group_size, best_group_amt = 1, sorted_amts[0]
        i = 0
        while i < len(sorted_amts):
            j = i
            while j + 1 < len(sorted_amts) and sorted_amts[i] > 0 and \
                    abs(sorted_amts[j + 1] - sorted_amts[i]) <= sorted_amts[i] * value_tolerance:
                j += 1
            group_size = j - i + 1
            if group_size > best_group_size:
                best_group_size, best_group_amt = group_size, sorted_amts[i]
            i = j + 1

        distinct_inputs = len(set(in_addrs or []))
        confidence = (best_group_size / len(out_amts)) * min(1.0, distinct_inputs / 3.0)

        if best_group_size >= min_equal_outputs and distinct_inputs >= min_distinct_inputs \
                and confidence >= mixer_confidence_threshold:
            result[txid] = {
                "confidence": round(confidence, 4),
                "equal_output_count": best_group_size,
                "equal_output_amount": best_group_amt,
                "distinct_inputs": distinct_inputs,
            }

    return result


def compute_mixer_interaction(
    con: duckdb.DuckDBPyConnection, coinjoin_txids: set[str],
) -> dict[str, int]:
    """{wallet_address: number of CoinJoin-like transactions it appears in}."""
    if not coinjoin_txids:
        return {}

    rows = con.execute("""
        SELECT txid, input_addresses, output_addresses FROM transactions
        WHERE txid = ANY(?)
    """, [list(coinjoin_txids)]).fetchall()

    counts: dict[str, int] = {}
    for _txid, in_addrs, out_addrs in rows:
        for addr in set((in_addrs or [])) | set((out_addrs or [])):
            counts[addr] = counts.get(addr, 0) + 1
    return counts


def detect_consolidation_hubs(
    con: duckdb.DuckDBPyConnection,
    min_fan_degree: int = 5,
    passthrough_tolerance: float = 0.15,
) -> dict[str, dict]:
    """
    A second, distinct mixing signature from single-transaction CoinJoin:
    a fan-in/fan-out consolidation hub — many separate small deposits from
    unrelated wallets into one address, which then fans back out to many
    separate withdrawal addresses, passing nearly all the value through
    rather than accumulating it. This is the "mixer/tumbler" shape a real
    mixing *service* actually produces on-chain (a CoinJoin is one
    transaction; a hosted mixer is a pass-through wallet across many).

    Returns {wallet_address: {"fan_in": int, "fan_out": int,
                               "passthrough_ratio": float}} for wallets
    matching the pattern.
    """
    rows = con.execute("""
        SELECT address, fan_in_degree, fan_out_degree, total_received, total_sent
        FROM wallet_features
        WHERE fan_in_degree >= ? AND fan_out_degree >= ?
    """, [min_fan_degree, min_fan_degree]).fetchall()

    result = {}
    for address, fan_in, fan_out, received, sent in rows:
        if not received or received <= 0:
            continue
        passthrough_ratio = min(sent, received) / received
        if passthrough_ratio >= (1 - passthrough_tolerance):
            result[address] = {
                "fan_in": fan_in, "fan_out": fan_out,
                "passthrough_ratio": round(passthrough_ratio, 4),
            }
    return result
