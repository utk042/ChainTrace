"""
ChainTrace Forensics — Transactions Router
"""

from fastapi import APIRouter, HTTPException, Query
from app.database import get_db_readonly
from typing import Optional

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])


@router.get("")
def list_transactions(
    search: Optional[str] = None,
    script_type: Optional[str] = None,
    page: int = Query(1, ge=1, description="1-based page number."),
    page_size: int = Query(20, ge=1, le=10_000,
                           description="Rows per page. Bounded so one request cannot pull the whole table into memory."),
    sort_by: str = "timestamp",
    sort_order: str = "desc",
):
    """List transactions with pagination."""
    with get_db_readonly() as con:
        conditions = ["1=1"]
        params = []

        if search:
            conditions.append("(txid LIKE ? OR src_ip LIKE ? OR dst_ip LIKE ?)")
            params.extend([f"%{search}%"] * 3)
        if script_type:
            conditions.append("script_type = ?")
            params.append(script_type)

        where = " AND ".join(conditions)
        valid_sorts = ["timestamp", "fee", "txid"]
        if sort_by not in valid_sorts:
            sort_by = "timestamp"
        order = "DESC" if sort_order.lower() == "desc" else "ASC"

        total = con.execute(f"SELECT COUNT(*) FROM transactions WHERE {where}", params).fetchone()[0]

        offset = (page - 1) * page_size
        rows = con.execute(f"""
            SELECT txid, timestamp, src_ip, dst_ip, src_port, dst_port,
                   input_addresses, output_addresses, input_amounts, output_amounts,
                   fee, script_type, geo_country_src, geo_country_dst, asn_src, asn_dst
            FROM transactions
            WHERE {where}
            ORDER BY {sort_by} {order}
            LIMIT ? OFFSET ?
        """, params + [page_size, offset]).fetchall()

        transactions = []
        for r in rows:
            total_in = sum(r[8]) if r[8] else 0
            total_out = sum(r[9]) if r[9] else 0
            transactions.append({
                "txid": r[0], "timestamp": str(r[1]),
                "src_ip": r[2], "dst_ip": r[3],
                "src_port": r[4], "dst_port": r[5],
                "input_addresses": r[6], "output_addresses": r[7],
                "input_amounts": r[8], "output_amounts": r[9],
                "fee": r[10], "script_type": r[11],
                "geo_country_src": r[12], "geo_country_dst": r[13],
                "asn_src": r[14], "asn_dst": r[15],
                "total_input": total_in, "total_output": total_out,
            })

        return {"transactions": transactions, "total": total, "page": page, "page_size": page_size}


@router.get("/{txid}")
def get_transaction_detail(txid: str):
    """Get detailed transaction information."""
    with get_db_readonly() as con:
        row = con.execute("""
            SELECT txid, timestamp, src_ip, dst_ip, src_port, dst_port,
                   input_addresses, output_addresses, input_amounts, output_amounts,
                   fee, script_type, geo_country_src, geo_country_dst, asn_src, asn_dst
            FROM transactions WHERE txid = ?
        """, [txid]).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"No transaction '{txid}' in the current dataset.")

        total_in = sum(row[8]) if row[8] else 0
        total_out = sum(row[9]) if row[9] else 0

        # Check for behavioral flags
        flags = []
        if row[8] and row[9]:
            # Round amount check
            for amt in row[9]:
                if amt == round(amt, 0) and amt > 0:
                    flags.append("Exact Round Number Outputs")
                    break
            # Peel chain check (1 input, 2 outputs with big size difference)
            if len(row[6]) == 1 and len(row[7]) == 2:
                amts = sorted(row[9])
                if amts[0] < amts[1] * 0.1:
                    flags.append("Peel Chain Pattern Detected")

        # Check associated alerts
        alerts = con.execute("""
            SELECT alert_id, risk_tier, confidence, description
            FROM alerts
            WHERE entity_id IN (SELECT unnest(?::VARCHAR[]))
        """, [row[6] + row[7]]).fetchall()

        return {
            "txid": row[0], "timestamp": str(row[1]),
            "src_ip": row[2], "dst_ip": row[3],
            "src_port": row[4], "dst_port": row[5],
            "input_addresses": row[6], "output_addresses": row[7],
            "input_amounts": row[8], "output_amounts": row[9],
            "fee": row[10], "script_type": row[11],
            "geo_country_src": row[12], "geo_country_dst": row[13],
            "asn_src": row[14], "asn_dst": row[15],
            "total_input": total_in, "total_output": total_out,
            "behavioral_flags": list(set(flags)),
            "connected_alerts": [
                {"alert_id": a[0], "risk_tier": a[1], "confidence": a[2], "description": a[3]}
                for a in alerts
            ],
        }
