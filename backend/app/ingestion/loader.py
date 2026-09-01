"""
ChainTrace Forensics — DuckDB Bulk Loader
Inserts validated and enriched transaction records into DuckDB.
"""

import json
import duckdb
from app.models.transaction import TransactionRecord
from app.database import get_db


def load_transactions(records: list[TransactionRecord], con: duckdb.DuckDBPyConnection = None) -> int:
    """
    Bulk insert transaction records into DuckDB.

    Returns: number of records inserted.
    """
    if not records:
        return 0

    own_connection = con is None
    if own_connection:
        ctx = get_db()
        con = ctx.__enter__()

    try:
        # Prepare batch data
        rows = []
        for r in records:
            rows.append((
                r.txid,
                r.timestamp.isoformat(),
                r.src_ip,
                r.dst_ip,
                r.src_port,
                r.dst_port,
                r.input_addresses,
                r.output_addresses,
                r.input_amounts,
                r.output_amounts,
                r.fee,
                r.script_type,
                r.geo_country_src,
                r.geo_country_dst,
                r.asn_src,
                r.asn_dst,
            ))

        # Use INSERT OR REPLACE to handle re-ingestion
        con.executemany("""
            INSERT OR REPLACE INTO transactions
            (txid, timestamp, src_ip, dst_ip, src_port, dst_port,
             input_addresses, output_addresses, input_amounts, output_amounts,
             fee, script_type, geo_country_src, geo_country_dst, asn_src, asn_dst)
            VALUES (?, ?::TIMESTAMP, ?, ?, ?, ?, ?::VARCHAR[], ?::VARCHAR[], ?::DOUBLE[], ?::DOUBLE[], ?, ?, ?, ?, ?, ?)
        """, rows)

        # Also populate ip_metadata table
        _update_ip_metadata(records, con)

        return len(rows)

    finally:
        if own_connection:
            ctx.__exit__(None, None, None)


def _update_ip_metadata(records: list[TransactionRecord], con: duckdb.DuckDBPyConnection) -> None:
    """Extract and upsert unique IP metadata."""
    ip_data: dict[str, dict] = {}

    for r in records:
        for ip, country, asn in [
            (r.src_ip, r.geo_country_src, r.asn_src),
            (r.dst_ip, r.geo_country_dst, r.asn_dst),
        ]:
            if ip not in ip_data:
                ip_data[ip] = {
                    "ip_address": ip,
                    "country": country or "XX",
                    "asn": asn or "Unknown",
                    "hit_count": 0,
                    "first_seen": r.timestamp.isoformat(),
                    "last_seen": r.timestamp.isoformat(),
                }
            ip_data[ip]["hit_count"] += 1
            if r.timestamp.isoformat() > ip_data[ip]["last_seen"]:
                ip_data[ip]["last_seen"] = r.timestamp.isoformat()
            if r.timestamp.isoformat() < ip_data[ip]["first_seen"]:
                ip_data[ip]["first_seen"] = r.timestamp.isoformat()

    ip_rows = [
        (d["ip_address"], d["country"], None, d["asn"], None, 0.0, 0.0,
         d["hit_count"], d["first_seen"], d["last_seen"])
        for d in ip_data.values()
    ]

    if ip_rows:
        con.executemany("""
            INSERT OR REPLACE INTO ip_metadata
            (ip_address, country, city, asn, org, latitude, longitude,
             hit_count, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::TIMESTAMP, ?::TIMESTAMP)
        """, ip_rows)


def clear_all_data(con: duckdb.DuckDBPyConnection = None) -> None:
    """Clear all data from all tables (for re-ingestion)."""
    own_connection = con is None
    if own_connection:
        ctx = get_db()
        con = ctx.__enter__()

    try:
        con.execute("DELETE FROM transactions")
        con.execute("DELETE FROM wallet_features")
        con.execute("DELETE FROM alerts")
        con.execute("DELETE FROM ip_metadata")
        con.execute("DELETE FROM pipeline_runs")
    finally:
        if own_connection:
            ctx.__exit__(None, None, None)
