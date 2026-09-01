"""
ChainTrace Forensics — Training Orchestrator
Coordinates the full ML pipeline: features → autoencoder → embeddings → alerts.
"""

import uuid
import numpy as np
from datetime import datetime
from pathlib import Path

from app.config import settings
from app.database import get_db
from app.graph.builder import build_entity_graph, get_graph_stats
from app.graph.clustering import cluster_wallets
from app.ml.features import compute_wallet_features, save_features_to_db, features_to_matrix, FEATURE_NAMES
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


def run_full_pipeline() -> dict:
    """
    Run the complete analysis pipeline:
    1. Build entity graph
    2. Cluster wallets (Louvain)
    3. Compute behavioral features
    4. Train autoencoder
    5. Train Node2Vec embeddings
    6. Score anomalies
    7. Generate SHAP explanations
    8. Create alerts

    Returns: Pipeline execution summary
    """
    global _entity_graph, _anomaly_detector, _graph_embedder, _explainer, _clusters, _wallet_features

    summary = {
        "started_at": datetime.utcnow().isoformat(),
        "steps": {},
    }

    print("\n" + "=" * 60)
    print("  ChainTrace Forensics — Full Analysis Pipeline")
    print("=" * 60)

    # ── Step 1: Build Entity Graph ────────────────────────────────
    print("\n[1/7] Building entity graph...")
    _entity_graph = build_entity_graph()
    graph_stats = get_graph_stats(_entity_graph)
    summary["steps"]["graph"] = graph_stats
    print(f"  ✓ Graph: {graph_stats['total_nodes']} nodes, {graph_stats['total_edges']} edges")

    # ── Step 2: Cluster Wallets ───────────────────────────────────
    print("\n[2/7] Clustering wallets (Louvain)...")
    _clusters = cluster_wallets(_entity_graph)
    summary["steps"]["clustering"] = {"clusters": len(_clusters)}
    print(f"  ✓ {len(_clusters)} wallet clusters detected")

    # ── Step 3: Compute Features ──────────────────────────────────
    print("\n[3/7] Computing behavioral features...")
    _wallet_features = compute_wallet_features()
    addresses, feature_matrix = features_to_matrix(_wallet_features)
    summary["steps"]["features"] = {"wallets": len(addresses), "dimensions": feature_matrix.shape[1]}
    print(f"  ✓ {len(addresses)} wallets × {feature_matrix.shape[1]} features")

    # Save features to DB
    save_features_to_db(_wallet_features)

    # ── Step 4: Train Autoencoder ─────────────────────────────────
    print("\n[4/7] Training autoencoder...")
    _anomaly_detector = AnomalyDetector()

    # Try loading existing model first
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

    # ── Step 5: Node2Vec Embeddings ───────────────────────────────
    print("\n[5/7] Training Node2Vec embeddings...")
    _graph_embedder = GraphEmbedder()

    if not _graph_embedder.load():
        _graph_embedder.fit(_entity_graph)
        _graph_embedder.save()
        summary["steps"]["embeddings"] = {"nodes": len(_graph_embedder.embeddings)}
    else:
        summary["steps"]["embeddings"] = {"loaded_from_disk": True}

    # ── Step 6: Score Anomalies ───────────────────────────────────
    print("\n[6/7] Scoring anomalies...")
    flags, scores = _anomaly_detector.predict(feature_matrix)
    n_flagged = int(np.sum(flags))
    summary["steps"]["scoring"] = {
        "total_wallets": len(addresses),
        "flagged": n_flagged,
        "flagged_pct": round(n_flagged / max(1, len(addresses)) * 100, 1),
    }
    print(f"  ✓ {n_flagged}/{len(addresses)} wallets flagged ({summary['steps']['scoring']['flagged_pct']}%)")

    # ── Step 7: Generate Explanations & Alerts ────────────────────
    print("\n[7/7] Generating explanations and alerts...")
    _explainer = AnomalyExplainer(_anomaly_detector)
    _explainer.initialize(feature_matrix)

    # Get flagged wallet indices
    flagged_indices = np.where(flags)[0]
    alerts_generated = 0

    with get_db() as con:
        # Clear existing alerts
        con.execute("DELETE FROM alerts")

        for idx in flagged_indices:
            addr = addresses[idx]
            score = float(scores[idx])

            # Get SHAP explanation
            shap_vals = _explainer.explain_single(feature_matrix[idx])
            description = _explainer.generate_description(shap_vals, score)

            # Determine risk tier
            if score >= 90:
                risk_tier = RiskTier.CRITICAL
            elif score >= 70:
                risk_tier = RiskTier.HIGH
            else:
                risk_tier = RiskTier.ELEVATED

            # Create alert
            alert_id = f"ALT-{uuid.uuid4().hex[:8].upper()}"

            import json
            shap_json = json.dumps(shap_vals[:5])  # Top 5 features

            con.execute("""
                INSERT INTO alerts
                (alert_id, entity_id, entity_type, risk_tier, confidence,
                 model, description, shap_values, timestamp, status)
                VALUES (?, ?, 'wallet', ?, ?, 'Autoencoder + Node2Vec', ?, ?, CURRENT_TIMESTAMP, 'pending')
            """, (alert_id, addr, risk_tier.value, round(score, 1),
                  description, shap_json))

            # Update wallet features with anomaly data
            con.execute("""
                UPDATE wallet_features
                SET anomaly_score = ?, risk_tier = ?, cluster_id = ?
                WHERE address = ?
            """, (round(score, 1), risk_tier.value,
                  _entity_graph.nodes[addr].get("cluster_id") if addr in _entity_graph else None,
                  addr))

            # Update graph node
            if addr in _entity_graph:
                _entity_graph.nodes[addr]["anomaly_score"] = score
                _entity_graph.nodes[addr]["risk_tier"] = risk_tier.value

            alerts_generated += 1

    summary["steps"]["alerts"] = {"generated": alerts_generated}
    summary["finished_at"] = datetime.utcnow().isoformat()

    print(f"  ✓ {alerts_generated} alerts generated")
    print("\n" + "=" * 60)
    print("  Pipeline complete!")
    print("=" * 60 + "\n")

    return summary
