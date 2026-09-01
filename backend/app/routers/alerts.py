"""
ChainTrace Forensics — Alerts Router
CRUD and filtering for anomaly alerts.
"""

import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from app.database import get_db_readonly, get_db
from typing import Optional
import csv
import io

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


@router.get("")
def list_alerts(
    risk_tier: Optional[str] = None,
    entity_type: Optional[str] = None,
    model: Optional[str] = None,
    min_confidence: float = 0.0,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "confidence",
    sort_order: str = "desc",
):
    """List alerts with filtering, sorting, and pagination."""
    with get_db_readonly() as con:
        conditions = ["1=1"]
        params = []

        if risk_tier:
            conditions.append("risk_tier = ?")
            params.append(risk_tier)
        if entity_type:
            conditions.append("entity_type = ?")
            params.append(entity_type)
        if model:
            conditions.append("model = ?")
            params.append(model)
        if min_confidence > 0:
            conditions.append("confidence >= ?")
            params.append(min_confidence)
        if status:
            conditions.append("status = ?")
            params.append(status)
        if search:
            conditions.append("(entity_id LIKE ? OR description LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])

        where = " AND ".join(conditions)

        # Validate sort column
        valid_sorts = ["confidence", "timestamp", "risk_tier", "entity_id"]
        if sort_by not in valid_sorts:
            sort_by = "confidence"
        order = "DESC" if sort_order.lower() == "desc" else "ASC"

        # Total count
        total = con.execute(f"SELECT COUNT(*) FROM alerts WHERE {where}", params).fetchone()[0]

        # Paginated results
        offset = (page - 1) * page_size
        rows = con.execute(f"""
            SELECT alert_id, entity_id, entity_type, risk_tier,
                   confidence, model, description, shap_values, timestamp, status
            FROM alerts
            WHERE {where}
            ORDER BY {sort_by} {order}
            LIMIT ? OFFSET ?
        """, params + [page_size, offset]).fetchall()

        alerts = []
        for r in rows:
            shap_vals = r[7]
            if isinstance(shap_vals, str):
                try:
                    shap_vals = json.loads(shap_vals)
                except json.JSONDecodeError:
                    shap_vals = []

            alerts.append({
                "alert_id": r[0],
                "entity_id": r[1],
                "entity_type": r[2],
                "risk_tier": r[3],
                "confidence": r[4],
                "model": r[5],
                "description": r[6],
                "shap_values": shap_vals,
                "timestamp": str(r[8]),
                "status": r[9],
            })

        return {
            "alerts": alerts,
            "total": total,
            "page": page,
            "page_size": page_size,
        }


@router.get("/export")
def export_alerts_csv():
    """Export all alerts as CSV."""
    with get_db_readonly() as con:
        rows = con.execute("""
            SELECT alert_id, entity_id, entity_type, risk_tier,
                   confidence, model, description, timestamp, status
            FROM alerts
            ORDER BY confidence DESC
        """).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Alert ID", "Entity ID", "Type", "Risk Tier",
                     "Confidence", "Model", "Description", "Timestamp", "Status"])
    for r in rows:
        writer.writerow(r)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=chaintrace_alerts.csv"},
    )


@router.get("/{alert_id}")
def get_alert_detail(alert_id: str):
    """Get detailed alert information including SHAP values."""
    with get_db_readonly() as con:
        row = con.execute("""
            SELECT alert_id, entity_id, entity_type, risk_tier,
                   confidence, model, description, shap_values, timestamp, status
            FROM alerts WHERE alert_id = ?
        """, [alert_id]).fetchone()

        if not row:
            return {"error": "Alert not found"}

        shap_vals = row[7]
        if isinstance(shap_vals, str):
            try:
                shap_vals = json.loads(shap_vals)
            except json.JSONDecodeError:
                shap_vals = []

        return {
            "alert_id": row[0],
            "entity_id": row[1],
            "entity_type": row[2],
            "risk_tier": row[3],
            "confidence": row[4],
            "model": row[5],
            "description": row[6],
            "shap_values": shap_vals,
            "timestamp": str(row[8]),
            "status": row[9],
        }


@router.put("/{alert_id}/status")
def update_alert_status(alert_id: str, new_status: str):
    """Update alert status (pending/investigating/resolved/dismissed)."""
    valid_statuses = ["pending", "investigating", "resolved", "dismissed"]
    if new_status not in valid_statuses:
        return {"error": f"Invalid status. Must be one of: {valid_statuses}"}

    with get_db() as con:
        con.execute(
            "UPDATE alerts SET status = ? WHERE alert_id = ?",
            [new_status, alert_id],
        )
        return {"alert_id": alert_id, "status": new_status}
