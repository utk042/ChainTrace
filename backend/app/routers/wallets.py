"""
ChainTrace Forensics — Wallets Router
"""

from fastapi import APIRouter, Query
from app.database import get_db_readonly
from typing import Optional

router = APIRouter(prefix="/api/wallets", tags=["Wallets"])


@router.get("")
def list_wallets(
    search: Optional[str] = None,
    risk_tier: Optional[str] = None,
    min_score: float = 0.0,
    sort_by: str = "anomaly_score",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
):
    """List wallets with filtering and pagination."""
    with get_db_readonly() as con:
        conditions = ["1=1"]
        params = []

        if search:
            conditions.append("address LIKE ?")
            params.append(f"%{search}%")
        if risk_tier:
            conditions.append("risk_tier = ?")
            params.append(risk_tier)
        if min_score > 0:
            conditions.append("anomaly_score >= ?")
            params.append(min_score)

        where = " AND ".join(conditions)
        valid_sorts = ["anomaly_score", "tx_count", "total_received", "total_sent",
                       "fan_in_degree", "fan_out_degree", "velocity_1h", "age_days"]
        if sort_by not in valid_sorts:
            sort_by = "anomaly_score"
        order = "DESC" if sort_order.lower() == "desc" else "ASC"

        total = con.execute(f"SELECT COUNT(*) FROM wallet_features WHERE {where}", params).fetchone()[0]

        offset = (page - 1) * page_size
        rows = con.execute(f"""
            SELECT address, tx_count, total_received, total_sent,
                   fan_in_degree, fan_out_degree, avg_tx_amount, amount_variance,
                   velocity_1h, velocity_24h, round_amount_ratio,
                   unique_ips, unique_countries, first_seen, last_seen, age_days,
                   cluster_id, anomaly_score, risk_tier
            FROM wallet_features
            WHERE {where}
            ORDER BY {sort_by} {order}
            LIMIT ? OFFSET ?
        """, params + [page_size, offset]).fetchall()

        wallets = []
        for r in rows:
            wallets.append({
                "address": r[0], "tx_count": r[1], "total_received": r[2],
                "total_sent": r[3], "fan_in_degree": r[4], "fan_out_degree": r[5],
                "avg_tx_amount": r[6], "amount_variance": r[7],
                "velocity_1h": r[8], "velocity_24h": r[9],
                "round_amount_ratio": r[10], "unique_ips": r[11],
                "unique_countries": r[12], "first_seen": str(r[13]) if r[13] else None,
                "last_seen": str(r[14]) if r[14] else None, "age_days": r[15],
                "cluster_id": r[16], "anomaly_score": r[17], "risk_tier": r[18],
            })

        return {"wallets": wallets, "total": total, "page": page, "page_size": page_size}


@router.get("/{address}")
def get_wallet_detail(address: str):
    """Get detailed wallet information with connected IPs and transactions."""
    with get_db_readonly() as con:
        row = con.execute("""
            SELECT address, tx_count, total_received, total_sent,
                   fan_in_degree, fan_out_degree, avg_tx_amount, amount_variance,
                   velocity_1h, velocity_24h, round_amount_ratio,
                   unique_ips, unique_countries, first_seen, last_seen, age_days,
                   cluster_id, anomaly_score, risk_tier
            FROM wallet_features WHERE address = ?
        """, [address]).fetchone()

        if not row:
            return {"error": "Wallet not found"}

        # Get connected transactions
        txs = con.execute("""
            SELECT txid, timestamp,
                   input_amounts, output_amounts, fee
            FROM transactions
            WHERE list_contains(input_addresses, ?) OR list_contains(output_addresses, ?)
            ORDER BY timestamp DESC
            LIMIT 20
        """, [address, address]).fetchall()

        recent_txs = []
        for tx in txs:
            total_in = sum(tx[2]) if tx[2] else 0
            total_out = sum(tx[3]) if tx[3] else 0
            recent_txs.append({
                "txid": tx[0],
                "timestamp": str(tx[1]),
                "total_input": total_in,
                "total_output": total_out,
                "fee": tx[4],
            })

        # Get connected IPs
        ips = con.execute("""
            SELECT DISTINCT src_ip as ip, geo_country_src as country, asn_src as asn
            FROM transactions
            WHERE list_contains(input_addresses, ?) OR list_contains(output_addresses, ?)
            UNION
            SELECT DISTINCT dst_ip as ip, geo_country_dst as country, asn_dst as asn
            FROM transactions
            WHERE list_contains(input_addresses, ?) OR list_contains(output_addresses, ?)
            LIMIT 50
        """, [address, address, address, address]).fetchall()

        connected_ips = [{"ip": ip[0], "country": ip[1], "asn": ip[2]} for ip in ips]

        # Get associated alerts
        alerts = con.execute("""
            SELECT alert_id, risk_tier, confidence, description
            FROM alerts WHERE entity_id = ?
        """, [address]).fetchall()

        return {
            "address": row[0], "tx_count": row[1], "total_received": row[2],
            "total_sent": row[3], "balance": round(row[2] - row[3], 8),
            "fan_in_degree": row[4], "fan_out_degree": row[5],
            "avg_tx_amount": row[6], "amount_variance": row[7],
            "velocity_1h": row[8], "velocity_24h": row[9],
            "round_amount_ratio": row[10], "unique_ips": row[11],
            "unique_countries": row[12],
            "first_seen": str(row[13]) if row[13] else None,
            "last_seen": str(row[14]) if row[14] else None,
            "age_days": row[15], "cluster_id": row[16],
            "anomaly_score": row[17], "risk_tier": row[18],
            "connected_ips": connected_ips,
            "recent_transactions": recent_txs,
            "alerts": [{"alert_id": a[0], "risk_tier": a[1], "confidence": a[2], "description": a[3]} for a in alerts],
        }
