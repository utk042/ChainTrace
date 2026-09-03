"""
ChainTrace Forensics — Dashboard Router
Provides aggregated statistics and timeline data for the dashboard.
"""

from fastapi import APIRouter, Depends
from app.database import get_db_readonly
from app.models.alert import DashboardStats, TimelinePoint

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats():
    """Get aggregated dashboard statistics."""
    with get_db_readonly() as con:
        # Transaction count
        tx_count = con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]

        # Wallet count
        wallet_count = con.execute("SELECT COUNT(*) FROM wallet_features").fetchone()[0]

        # IP count
        ip_count = con.execute("SELECT COUNT(*) FROM ip_metadata").fetchone()[0]

        # Alert counts by tier
        alert_counts = con.execute("""
            SELECT risk_tier, COUNT(*) as cnt
            FROM alerts
            GROUP BY risk_tier
        """).fetchall()

        critical = sum(c for t, c in alert_counts if t == "Critical")
        high = sum(c for t, c in alert_counts if t == "High")
        elevated = sum(c for t, c in alert_counts if t == "Elevated")
        total_alerts = critical + high + elevated

        # Flagged entities (unique)
        flagged = con.execute(
            "SELECT COUNT(DISTINCT entity_id) FROM alerts"
        ).fetchone()[0]

        # Clusters
        clusters = con.execute(
            "SELECT COUNT(DISTINCT cluster_id) FROM wallet_features WHERE cluster_id IS NOT NULL"
        ).fetchone()[0]

        # Last ingest
        last_ingest_row = con.execute(
            "SELECT MAX(started_at) FROM pipeline_runs"
        ).fetchone()
        last_ingest = last_ingest_row[0] if last_ingest_row and last_ingest_row[0] else None

        return DashboardStats(
            total_transactions=tx_count,
            total_wallets=wallet_count,
            total_ips=ip_count,
            total_alerts=total_alerts,
            critical_alerts=critical,
            high_alerts=high,
            elevated_alerts=elevated,
            flagged_entities=flagged,
            clusters_detected=clusters,
            last_ingest=last_ingest,
            # The models that actually ran; a light-mode host has neither
            # the neural autoencoder nor Node2Vec.
            model_name=_model_label(),
        )


def _model_label() -> str:
    from app.ml.autoencoder import is_light_mode
    if is_light_mode():
        return "PCA autoencoder + structural embeddings"
    return "Autoencoder + Node2Vec"


@router.get("/timeline")
def get_activity_timeline(interval: str = "day"):
    """Get transaction activity over time."""
    with get_db_readonly() as con:
        if interval == "hour":
            trunc = "hour"
        elif interval == "day":
            trunc = "day"
        else:
            trunc = "day"

        rows = con.execute(f"""
            SELECT date_trunc('{trunc}', timestamp) as period,
                   COUNT(*) as count
            FROM transactions
            GROUP BY period
            ORDER BY period
        """).fetchall()

        # Get anomaly counts per period
        anomaly_rows = con.execute(f"""
            SELECT date_trunc('{trunc}', a.timestamp) as period,
                   COUNT(*) as anomaly_count
            FROM alerts a
            GROUP BY period
        """).fetchall()

        anomaly_map = {str(r[0]): r[1] for r in anomaly_rows}

        timeline = []
        for row in rows:
            period_str = str(row[0])
            timeline.append({
                "timestamp": period_str,
                "count": row[1],
                "anomaly_count": anomaly_map.get(period_str, 0),
            })

        return timeline


@router.get("/risk-distribution")
def get_risk_distribution():
    """Get distribution of anomaly scores."""
    with get_db_readonly() as con:
        rows = con.execute("""
            SELECT
                CASE
                    WHEN anomaly_score >= 90 THEN 'Critical'
                    WHEN anomaly_score >= 70 THEN 'High'
                    WHEN anomaly_score >= 50 THEN 'Elevated'
                    WHEN anomaly_score > 0  THEN 'Low'
                    ELSE 'Normal'
                END as tier,
                COUNT(*) as count
            FROM wallet_features
            GROUP BY tier
            ORDER BY count DESC
        """).fetchall()

        return [{"tier": r[0], "count": r[1]} for r in rows]


@router.get("/top-alerts")
def get_top_alerts(limit: int = 5):
    """Get top N alerts by confidence."""
    with get_db_readonly() as con:
        rows = con.execute("""
            SELECT alert_id, entity_id, entity_type, risk_tier,
                   confidence, model, description, shap_values, timestamp, status
            FROM alerts
            ORDER BY confidence DESC
            LIMIT ?
        """, [limit]).fetchall()

        return [
            {
                "alert_id": r[0],
                "entity_id": r[1],
                "entity_type": r[2],
                "risk_tier": r[3],
                "confidence": r[4],
                "model": r[5],
                "description": r[6],
                "shap_values": r[7],
                "timestamp": str(r[8]),
                "status": r[9],
            }
            for r in rows
        ]
