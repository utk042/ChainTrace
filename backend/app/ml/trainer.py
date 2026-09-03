"""
ChainTrace Forensics — Training Orchestrator
Coordinates the full ML pipeline: graph -> clustering -> pattern/risk
detectors -> features -> autoencoder -> embeddings -> alerts.
"""

import uuid
import json
import numpy as np
from datetime import datetime

from app.config import settings
from app.database import get_db, get_db_readonly
from app.runtime_settings import get_effective_settings
from app.graph.builder import build_entity_graph, get_graph_stats
from app.graph.clustering import cluster_wallets, refine_clusters_with_embeddings
from app.graph.patterns import (
    detect_peeling_chains, detect_coinjoin_transactions, compute_mixer_interaction,
    detect_consolidation_hubs,
)
from app.graph.risk_propagation import propagate_risk
from app.ml.features import (
    compute_wallet_features, save_features_to_db, features_to_matrix,
    merge_pattern_features, FEATURE_NAMES,
)
from app.ml.autoencoder import AnomalyDetector
from app.ml.embeddings import GraphEmbedder
from app.ml.explainer import AnomalyExplainer
from app.models.alert import RiskTier


# Module-level state (shared across requests)
_entity_graph = None
_anomaly_detector = None
_graph_embedder = None
_explainer = None
_clusters = None
_wallet_features = None


def get_entity_graph():
    global _entity_graph
    return _entity_graph


def get_detector():
    global _anomaly_detector
    return _anomaly_detector


def get_embedder():
    global _graph_embedder
    return _graph_embedder


def get_explainer():
    global _explainer
    return _explainer


def get_clusters():
    global _clusters
    return _clusters


def get_wallet_features():
    global _wallet_features
    return _wallet_features


def _get_seed_wallets(con) -> set[str]:
    rows = con.execute("SELECT address FROM seed_wallets").fetchall()
    return {r[0] for r in rows}


def _risk_tier_for_score(score: float) -> RiskTier:
    if score >= 90:
        return RiskTier.CRITICAL
    if score >= 70:
        return RiskTier.HIGH
    return RiskTier.ELEVATED


def run_full_pipeline() -> dict:
    """
    Run the complete analysis pipeline:
    1.  Build entity graph
    2.  Cluster wallets (Louvain, common-input-ownership heuristic)
    3.  Detect laundering-pattern structures (peeling chains, CoinJoin-like
        mixing) and propagate risk from seed/watchlist wallets
    4.  Compute behavioral + structural features
    5.  Train autoencoder
    6.  Train Node2Vec embeddings, refine clusters with them
    7.  Score anomalies
    8.  Generate SHAP explanations and alerts (autoencoder + the two
        structural detectors + risk propagation)

    Returns: Pipeline execution summary
    """
    global _entity_graph, _anomaly_detector, _graph_embedder, _explainer, _clusters, _wallet_features

    from app.ml.autoencoder import backend_name, is_light_mode

    summary = {
        "started_at": datetime.utcnow().isoformat(),
        # Which analysis backends actually ran, so the run summary never
        # implies a neural autoencoder trained on a host that hasn't got one.
        "ml_backend": backend_name(),
        "light_mode": is_light_mode(),
        "steps": {},
    }
    eff = get_effective_settings()

    print("\n" + "=" * 60)
    print("  ChainTrace Forensics — Full Analysis Pipeline")
    print("=" * 60)

    # ── Step 1: Build Entity Graph ────────────────────────────────
    print("\n[1/8] Building entity graph...")
    _entity_graph = build_entity_graph()
    graph_stats = get_graph_stats(_entity_graph)
    summary["steps"]["graph"] = graph_stats
    print(f"  ✓ Graph: {graph_stats['total_nodes']} nodes, {graph_stats['total_edges']} edges")

    # ── Step 2: Cluster Wallets ───────────────────────────────────
    print("\n[2/8] Clustering wallets (Louvain + common-input heuristic)...")
    _clusters = cluster_wallets(_entity_graph)
    summary["steps"]["clustering"] = {"clusters": len(_clusters)}
    print(f"  ✓ {len(_clusters)} wallet clusters detected")

    # ── Step 3: Pattern Detection & Risk Propagation ──────────────
    print("\n[3/8] Detecting laundering patterns & propagating seed risk...")
    with get_db_readonly() as con:
        peel_data = detect_peeling_chains(con)
        coinjoin_txs = detect_coinjoin_transactions(
            con, mixer_confidence_threshold=eff["mixer_confidence_threshold"],
        )
        mixer_counts = compute_mixer_interaction(con, set(coinjoin_txs.keys()))
        seed_wallets = _get_seed_wallets(con)

    proximity_data = propagate_risk(
        _entity_graph, seed_wallets,
        max_hops=int(eff["darknet_proximity_hops"]),
    )
    chain_count = sum(1 for d in peel_data.values() if d["peel_chain_role"] == "chain")
    summary["steps"]["patterns"] = {
        "peeling_chains_detected": chain_count,
        "wallets_with_peel_activity": len(peel_data),
        "coinjoin_like_transactions": len(coinjoin_txs),
        "wallets_touching_mixers": len(mixer_counts),
        "seed_wallets": len(seed_wallets),
        "wallets_in_seed_proximity": len(proximity_data),
    }
    print(f"  ✓ {chain_count} peeling chains, {len(coinjoin_txs)} CoinJoin-like txs, "
          f"{len(proximity_data)} wallets within {int(eff['darknet_proximity_hops'])} hops of "
          f"{len(seed_wallets)} seed wallet(s)")

    # ── Step 4: Compute Features ──────────────────────────────────
    print("\n[4/8] Computing behavioral + structural features...")
    _wallet_features = compute_wallet_features()
    merge_pattern_features(_wallet_features, peel_data, mixer_counts, proximity_data)
    addresses, feature_matrix = features_to_matrix(_wallet_features)
    summary["steps"]["features"] = {"wallets": len(addresses), "dimensions": feature_matrix.shape[1]}
    print(f"  ✓ {len(addresses)} wallets × {feature_matrix.shape[1]} features ({', '.join(FEATURE_NAMES)})")

    # Save features to DB
    save_features_to_db(_wallet_features)

    # Consolidation-hub mixing detection needs fan_in/fan_out/received/sent
    # from wallet_features, so it can only run once that table is populated
    # — unlike the peel-chain/CoinJoin detectors above, which read raw
    # transactions directly. Distinct signature from single-tx CoinJoin: a
    # pass-through wallet aggregating many small deposits and fanning them
    # back out, which is what a hosted mixing *service* actually looks like
    # on-chain.
    with get_db_readonly() as con:
        hub_data = detect_consolidation_hubs(con)
    for addr in hub_data:
        if addr in _wallet_features:
            _wallet_features[addr]["mixer_interaction_count"] = (
                _wallet_features[addr].get("mixer_interaction_count", 0) + 1
            )
    if hub_data:
        save_features_to_db(_wallet_features)
    summary["steps"]["patterns"]["consolidation_hubs_detected"] = len(hub_data)
    print(f"  ✓ {len(hub_data)} consolidation-hub (fan-in/fan-out mixing) wallet(s) detected")

    # ── Step 5: Train Autoencoder ─────────────────────────────────
    print("\n[5/8] Training autoencoder...")
    _anomaly_detector = AnomalyDetector()

    if not _anomaly_detector.load():
        history = _anomaly_detector.train(feature_matrix)
        _anomaly_detector.save()
        summary["steps"]["autoencoder"] = {
            "epochs": settings.AE_EPOCHS,
            "final_loss": history["loss"][-1],
            "threshold": history["threshold"],
        }
    else:
        summary["steps"]["autoencoder"] = {"loaded_from_disk": True}

    # ── Step 6: Node2Vec Embeddings + Cluster Refinement ──────────
    print("\n[6/8] Training Node2Vec embeddings...")
    _graph_embedder = GraphEmbedder()

    # Unlike the autoencoder, embedding_dim never changes, so a cached file
    # always *loads* successfully — but it's keyed by node id, and a cached
    # file trained on a previous dataset's node ids is silently useless
    # against a re-ingested graph with different ones (similar-wallets
    # lookups would just come back empty). Treat a cache that covers too
    # little of the current graph as stale and retrain, the same principle
    # as the autoencoder's dim-mismatch check above.
    graph_node_count = _entity_graph.number_of_nodes()
    cache_loaded = _graph_embedder.load()
    if cache_loaded and graph_node_count > 0:
        coverage = sum(1 for n in _entity_graph.nodes if n in _graph_embedder.embeddings) / graph_node_count
        if coverage < 0.9:
            print(f"  ⚠ Cached embeddings cover only {coverage:.0%} of the current graph. Discarding, will retrain.")
            cache_loaded = False

    if not cache_loaded:
        _graph_embedder.fit(_entity_graph)
        _graph_embedder.save()
        summary["steps"]["embeddings"] = {"nodes": len(_graph_embedder.embeddings)}
    else:
        summary["steps"]["embeddings"] = {"loaded_from_disk": True}

    before = len(_clusters)
    _clusters = refine_clusters_with_embeddings(_entity_graph, _clusters, _graph_embedder)
    summary["steps"]["embeddings"]["clusters_merged_by_similarity"] = before - len(_clusters)
    print(f"  ✓ {len(_graph_embedder.embeddings)} embeddings; "
          f"{before - len(_clusters)} singleton cluster(s) merged by embedding similarity")

    # ── Step 7: Score Anomalies ───────────────────────────────────
    print("\n[7/8] Scoring anomalies...")
    flags, scores = _anomaly_detector.predict(feature_matrix)
    n_flagged = int(np.sum(flags))
    summary["steps"]["scoring"] = {
        "total_wallets": len(addresses),
        "flagged": n_flagged,
        "flagged_pct": round(n_flagged / max(1, len(addresses)) * 100, 1),
    }
    print(f"  ✓ {n_flagged}/{len(addresses)} wallets flagged ({summary['steps']['scoring']['flagged_pct']}%)")

    # ── Step 8: Generate Explanations & Alerts ────────────────────
    print("\n[8/8] Generating explanations and alerts...")
    _explainer = AnomalyExplainer(_anomaly_detector)
    _explainer.initialize(feature_matrix)

    addr_to_idx = {addr: i for i, addr in enumerate(addresses)}

    # A wallet gets an alert if the autoencoder flagged it OR a structural
    # detector found something concrete on it — a wallet doing a textbook
    # peeling chain shouldn't go unflagged just because its generic
    # behavioral stats didn't clear the anomaly percentile.
    autoencoder_flagged = {addresses[i] for i in np.where(flags)[0]}
    peel_chain_flagged = {a for a, d in peel_data.items() if d["peel_chain_role"] == "chain" and a in addr_to_idx}
    coinjoin_touch_flagged = {a for a in mixer_counts if a in addr_to_idx}
    hub_flagged = {a for a in hub_data if a in addr_to_idx}
    mixer_flagged = coinjoin_touch_flagged | hub_flagged
    proximity_flagged = {
        a for a, d in proximity_data.items()
        if a in addr_to_idx and a not in seed_wallets and d["darknet_proximity_hops"] <= 2
    }

    alert_candidates = autoencoder_flagged | peel_chain_flagged | mixer_flagged | proximity_flagged
    alerts_generated = 0

    with get_db() as con:
        con.execute("DELETE FROM alerts")

        for addr in alert_candidates:
            idx = addr_to_idx[addr]
            score = float(scores[idx])
            shap_vals = _explainer.explain_single(feature_matrix[idx])

            # Structural findings are the more specific, more useful
            # explanation when present — lead with those; otherwise fall
            # back to the generic SHAP-driven description.
            reasons = []
            models = []
            if addr in peel_chain_flagged:
                depth = peel_data[addr]["peel_chain_depth"]
                reasons.append(f"Peeling chain: participates in a {depth}-hop peel sequence "
                                f"(large 'change' output forwarded onward, small amount peeled off, repeated).")
                models.append("Peel-Chain")
                score = max(score, min(97.0, 55 + depth * 10))
            if addr in hub_flagged:
                h = hub_data[addr]
                reasons.append(f"Consolidation/mixing hub: {h['fan_in']} inbound and {h['fan_out']} "
                                f"outbound counterparties, passing through {h['passthrough_ratio']:.0%} "
                                f"of received value rather than accumulating it.")
                models.append("Mixer-Hub")
                score = max(score, 80.0)
            if addr in coinjoin_touch_flagged:
                n = mixer_counts[addr]
                reasons.append(f"CoinJoin-like mixer interaction: touches {n} transaction(s) with several "
                                f"equal-value outputs from multiple distinct inputs.")
                models.append("CoinJoin")
                score = max(score, 80.0)
            if addr in proximity_flagged:
                hops = proximity_data[addr]["darknet_proximity_hops"]
                reasons.append(f"{hops} hop(s) from a known-illicit seed wallet on the operator's watchlist.")
                models.append("Risk-Propagation")
                score = max(score, min(95.0, 90 - hops * 15))
            if addr in autoencoder_flagged or not reasons:
                reasons.append(_explainer.generate_description(shap_vals, score, eff))
                models.append("Autoencoder")

            description = " ".join(reasons)
            model_str = " + ".join(dict.fromkeys(models))  # de-duplicate, keep order
            risk_tier = _risk_tier_for_score(score)

            alert_id = f"ALT-{uuid.uuid4().hex[:8].upper()}"
            shap_json = json.dumps(shap_vals[:5])

            con.execute("""
                INSERT INTO alerts
                (alert_id, entity_id, entity_type, risk_tier, confidence,
                 model, description, shap_values, timestamp, status)
                VALUES (?, ?, 'wallet', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
            """, (alert_id, addr, risk_tier.value, round(score, 1),
                  model_str, description, shap_json))

            con.execute("""
                UPDATE wallet_features
                SET anomaly_score = ?, risk_tier = ?, cluster_id = ?
                WHERE address = ?
            """, (round(score, 1), risk_tier.value,
                  _entity_graph.nodes[addr].get("cluster_id") if addr in _entity_graph else None,
                  addr))

            if addr in _entity_graph:
                _entity_graph.nodes[addr]["anomaly_score"] = score
                _entity_graph.nodes[addr]["risk_tier"] = risk_tier.value

            alerts_generated += 1

    summary["steps"]["alerts"] = {
        "generated": alerts_generated,
        "from_autoencoder": len(autoencoder_flagged),
        "from_peeling_chain": len(peel_chain_flagged),
        "from_coinjoin_mixer": len(mixer_flagged),
        "from_risk_propagation": len(proximity_flagged),
    }
    summary["finished_at"] = datetime.utcnow().isoformat()

    print(f"  ✓ {alerts_generated} alerts generated")
    print("\n" + "=" * 60)
    print("  Pipeline complete!")
    print("=" * 60 + "\n")

    return summary
