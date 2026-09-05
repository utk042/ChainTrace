#!/usr/bin/env python3
"""
ChainTrace Forensics — Detector Benchmark

Answers "would Isolation Forest do better than what we run?" with numbers
instead of intuition. Builds the pipeline's own 16-feature wallet matrix from
a labelled synthetic dataset (scripts/generate_synthetic.py embeds six known
laundering patterns), then scores the same matrix with:

  • the autoencoder this deployment would actually use (torch or PCA),
  • sklearn's IsolationForest at the same contamination budget,
  • the structural detectors alone (peel chains, CoinJoin, consolidation
    hubs, seed-wallet proximity),
  • each unsupervised scorer unioned with the structural detectors, which
    is the shape run_full_pipeline() alerts on.

Ground truth is wallet-level: a wallet counts as illicit if it appears in
any transaction the generator labelled as something other than "normal".
That is a generous label — the one-off deposit wallets feeding a mixer are
labelled illicit while having a single transaction each and no distinguishing
behaviour — so absolute recall reads low for every detector here. The
comparison between rows is the point, not the absolute numbers.

Usage:
    python -m scripts.benchmark_detectors --seeds 42 7 13 --count 5000
    CT_LIGHT_MODE=true python -m scripts.benchmark_detectors   # PCA backend

Runs against a throwaway DuckDB in a temp directory; it never touches the
deployment's data/chaintrace.duckdb.
"""

import argparse
import os
import statistics
import sys
import tempfile
from datetime import datetime


def _isolate_storage() -> None:
    """Point config at a temp DB/model dir before app.config is imported."""
    tmp = tempfile.mkdtemp(prefix="ct-benchmark-")
    os.environ["CT_DUCKDB_PATH"] = os.path.join(tmp, "benchmark.duckdb")
    os.environ["CT_MODELS_DIR"] = os.path.join(tmp, "models")


_isolate_storage()

import numpy as np  # noqa: E402
from sklearn.ensemble import IsolationForest  # noqa: E402
from sklearn.metrics import average_precision_score, roc_auc_score  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import get_db, get_db_readonly  # noqa: E402
from app.graph.builder import build_entity_graph  # noqa: E402
from app.graph.patterns import (  # noqa: E402
    compute_mixer_interaction, detect_coinjoin_transactions,
    detect_consolidation_hubs, detect_peeling_chains,
)
from app.graph.risk_propagation import propagate_risk  # noqa: E402
from app.ml.autoencoder import AnomalyDetector, backend_name  # noqa: E402
from app.ml.features import (  # noqa: E402
    FEATURE_NAMES, compute_wallet_features, features_to_matrix,
    merge_pattern_features, save_features_to_db,
)
from scripts.generate_synthetic import DARKNET_WALLETS, generate_dataset  # noqa: E402


# ── Dataset ───────────────────────────────────────────────────────────────

def _load_dataset(count: int, seed: int) -> list[dict]:
    """Generate a labelled dataset and load it into the throwaway DuckDB."""
    records = generate_dataset(total=count, seed=seed)

    with get_db() as con:
        con.execute("DELETE FROM transactions")
        con.executemany(
            "INSERT OR REPLACE INTO transactions VALUES "
            "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(r["txid"], datetime.fromisoformat(r["timestamp"]), r["src_ip"],
              r["dst_ip"], r["src_port"], r["dst_port"], r["input_addresses"],
              r["output_addresses"], r["input_amounts"], r["output_amounts"],
              r["fee"], r["script_type"], r["geo_country_src"],
              r["geo_country_dst"], r["asn_src"], r["asn_dst"])
             for r in records],
        )
        # The generator's darknet wallets stand in for the operator's
        # watchlist; risk propagation has nothing to seed from otherwise.
        con.execute("DELETE FROM seed_wallets")
        for wallet in DARKNET_WALLETS:
            con.execute(
                "INSERT OR REPLACE INTO seed_wallets (address) VALUES (?)", (wallet,)
            )

    return records


def _ground_truth(records: list[dict]) -> dict[str, bool]:
    labels: dict[str, bool] = {}
    for r in records:
        illicit = r["_label"] != "normal"
        for addr in list(r["input_addresses"]) + list(r["output_addresses"]):
            labels[addr] = labels.get(addr, False) or illicit
    return labels


def _build_features():
    """Steps 1-4 of run_full_pipeline(), minus the parts scoring doesn't need."""
    graph = build_entity_graph()

    with get_db_readonly() as con:
        peel = detect_peeling_chains(con)
        coinjoin = detect_coinjoin_transactions(
            con, mixer_confidence_threshold=settings.MIXER_CONFIDENCE_THRESHOLD,
        )
        mixer_counts = compute_mixer_interaction(con, set(coinjoin.keys()))
        seeds = {r[0] for r in con.execute("SELECT address FROM seed_wallets").fetchall()}

    proximity = propagate_risk(graph, seeds, max_hops=settings.DARKNET_PROXIMITY_HOPS)

    features = compute_wallet_features()
    merge_pattern_features(features, peel, mixer_counts, proximity)
    # Consolidation-hub detection reads wallet_features, so it can only run
    # once the table is populated — same ordering as the pipeline.
    save_features_to_db(features)
    with get_db_readonly() as con:
        hubs = detect_consolidation_hubs(con)

    addresses, matrix = features_to_matrix(features)
    return addresses, matrix, dict(
        peel=peel, coinjoin=coinjoin, mixer_counts=mixer_counts,
        hubs=hubs, proximity=proximity, seeds=seeds,
    )


def _structural_mask(addresses: list[str], det: dict) -> np.ndarray:
    """The wallets run_full_pipeline() alerts on for a structural reason."""
    index = {a: i for i, a in enumerate(addresses)}
    mask = np.zeros(len(addresses), dtype=bool)

    for addr, d in det["peel"].items():
        if d["peel_chain_role"] == "chain" and addr in index:
            mask[index[addr]] = True
    for addr in set(det["mixer_counts"]) | set(det["hubs"]):
        if addr in index:
            mask[index[addr]] = True
    for addr, d in det["proximity"].items():
        if addr in index and addr not in det["seeds"] and d["darknet_proximity_hops"] <= 2:
            mask[index[addr]] = True

    return mask


# ── Scoring ───────────────────────────────────────────────────────────────

def _metrics(y: np.ndarray, scores: np.ndarray, flags: np.ndarray,
             subset: np.ndarray) -> dict:
    y, flags, scores = y[subset], flags[subset], scores[subset]
    tp = int((flags & y).sum())
    fp = int((flags & ~y).sum())
    fn = int((~flags & y).sum())
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    return {
        "flagged": int(flags.sum()),
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / max(1e-9, precision + recall),
        # Undefined when the subset is all one class — reported as nan
        # rather than a number that looks like a score.
        "pr_auc": float(average_precision_score(y, scores)) if y.any() and not y.all() else float("nan"),
        "roc_auc": float(roc_auc_score(y, scores)) if y.any() and not y.all() else float("nan"),
    }


def run_seed(count: int, seed: int, min_tx: int) -> dict[str, dict]:
    records = _load_dataset(count, seed)
    truth = _ground_truth(records)
    addresses, X, det = _build_features()

    y = np.array([truth.get(a, False) for a in addresses], dtype=bool)
    structural = _structural_mask(addresses, det)
    active = X[:, FEATURE_NAMES.index("tx_count")] >= min_tx
    everything = np.ones(len(addresses), dtype=bool)

    if y[active].all() or not y[active].any():
        print(f"  note: the tx_count >= {min_tx} subset is entirely "
              f"{'illicit' if y[active].all() else 'benign'} — its precision/recall "
              f"carry no information. Read the 'all wallets' table instead, or "
              f"lower --min-tx.")
    print(f"  seed {seed}: {len(addresses)} wallets, {int(y.sum())} illicit "
          f"({y.mean():.1%}), {int(active.sum())} with >={min_tx} tx; "
          f"structural hits: {int(structural.sum())} "
          f"(peel={sum(1 for d in det['peel'].values() if d['peel_chain_role'] == 'chain')}, "
          f"coinjoin_tx={len(det['coinjoin'])}, hubs={len(det['hubs'])}, "
          f"proximity={len(det['proximity'])})")

    # The autoencoder this deployment would run, on the pipeline's own matrix.
    detector = AnomalyDetector()
    detector.train(X)
    ae_scores = detector.score(X)
    ae_flags = ae_scores > detector.threshold

    # Isolation Forest at the same flag budget.
    X_scaled = StandardScaler().fit_transform(X)
    forest = IsolationForest(
        n_estimators=200,
        contamination=(100 - settings.ANOMALY_PERCENTILE) / 100,
        random_state=seed,
    ).fit(X_scaled)
    if_scores = -forest.score_samples(X_scaled)
    if_flags = if_scores > np.percentile(if_scores, settings.ANOMALY_PERCENTILE)

    candidates = {
        f"{backend_name()}": (ae_scores, ae_flags),
        "isolation-forest": (if_scores, if_flags),
        "structural-only": (structural.astype(float), structural),
        f"{backend_name()} + structural": (ae_scores, ae_flags | structural),
        "isolation-forest + structural": (if_scores, if_flags | structural),
    }

    return {
        name: {
            "all": _metrics(y, scores, flags, everything),
            "active": _metrics(y, scores, flags, active),
        }
        for name, (scores, flags) in candidates.items()
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[2])
    parser.add_argument("--seeds", type=int, nargs="+", default=[42, 7, 13])
    parser.add_argument("--count", type=int, default=5000,
                        help="Transactions per synthetic dataset")
    parser.add_argument("--min-tx", type=int, default=3,
                        help="tx_count cutoff for the 'active wallets' view")
    args = parser.parse_args()

    print(f"Backend under test: {backend_name()} "
          f"(light_mode={settings.LIGHT_MODE}) — {args.count} tx/seed\n")

    per_seed = [run_seed(args.count, seed, args.min_tx) for seed in args.seeds]

    print(f"\nMean over {len(args.seeds)} seed(s). "
          f"'all' = every wallet; 'active' = tx_count >= {args.min_tx}.\n")
    header = f"{'detector':34s} {'flag':>6s} {'P':>6s} {'R':>6s} {'F1':>6s} {'PR-AUC':>7s}"
    for view in ("all", "active"):
        print(f"── {view} wallets ──")
        print(header)
        for name in per_seed[0]:
            vals = [s[name][view] for s in per_seed]
            def avg(k): return statistics.fmean(v[k] for v in vals)
            print(f"{name:34s} {avg('flagged'):6.0f} {avg('precision'):6.3f} "
                  f"{avg('recall'):6.3f} {avg('f1'):6.3f} {avg('pr_auc'):7.3f}")
        print()


if __name__ == "__main__":
    sys.exit(main())
