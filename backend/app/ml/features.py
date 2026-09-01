"""
ChainTrace Forensics — Feature Engineering
Computes 13 behavioral features per wallet address from DuckDB data.
"""

import numpy as np
import duckdb
from datetime import datetime
from app.database import get_db_readonly, get_db


FEATURE_NAMES = [
    "tx_count",
    "total_received",
    "total_sent",
    "fan_in_degree",
    "fan_out_degree",
    "avg_tx_amount",
    "amount_variance",
    "velocity_1h",
    "velocity_24h",
    "round_amount_ratio",
    "unique_ips",
    "unique_countries",
    "age_days",
]


def compute_wallet_features(con: duckdb.DuckDBPyConnection = None) -> dict[str, dict]:
    """
    Compute behavioral features for every wallet address in the dataset.

    Returns: {address: {feature_name: value, ...}}
    """
    own_con = con is None
    if own_con:
        ctx = get_db_readonly()
        con = ctx.__enter__()

    try:
        # Gather all wallet activity
        rows = con.execute("""
            SELECT txid, timestamp, src_ip, dst_ip,
                   input_addresses, output_addresses,
                   input_amounts, output_amounts,
                   geo_country_src, geo_country_dst
            FROM transactions
            ORDER BY timestamp
        """).fetchall()

        # Build per-wallet activity records
        wallet_data: dict[str, dict] = {}

        for row in rows:
            txid, ts, src_ip, dst_ip, in_addrs, out_addrs, \
                in_amts, out_amts, country_src, country_dst = row

            # Process input wallets (senders)
            if in_addrs:
                for i, addr in enumerate(in_addrs):
                    if addr not in wallet_data:
                        wallet_data[addr] = _empty_wallet()
                    w = wallet_data[addr]
                    amt = in_amts[i] if in_amts and i < len(in_amts) else 0.0
                    w["tx_timestamps"].append(ts)
                    w["total_sent"] += amt
                    w["amounts"].append(amt)
                    if src_ip:
                        w["ips"].add(src_ip)
                    if dst_ip:
                        w["ips"].add(dst_ip)
                    w["countries"].add(country_src or "XX")
                    w["countries"].add(country_dst or "XX")
                    w["output_wallets"].update(out_addrs or [])

            # Process output wallets (receivers)
            if out_addrs:
                for i, addr in enumerate(out_addrs):
                    if addr not in wallet_data:
                        wallet_data[addr] = _empty_wallet()
                    w = wallet_data[addr]
                    amt = out_amts[i] if out_amts and i < len(out_amts) else 0.0
                    w["tx_timestamps"].append(ts)
                    w["total_received"] += amt
                    w["amounts"].append(amt)
                    if src_ip:
                        w["ips"].add(src_ip)
                    if dst_ip:
                        w["ips"].add(dst_ip)
                    w["countries"].add(country_src or "XX")
                    w["countries"].add(country_dst or "XX")
                    w["input_wallets"].update(in_addrs or [])

        # Compute features
        features = {}
        for addr, w in wallet_data.items():
            timestamps = sorted(w["tx_timestamps"])
            amounts = w["amounts"]
            tx_count = len(timestamps)

            # Fan-in: unique wallets that sent TO this address
            fan_in = len(w["input_wallets"])
            # Fan-out: unique wallets this address sent TO
            fan_out = len(w["output_wallets"])

            # Velocity: max transactions within a 1-hour and 24-hour sliding window
            v1h = _max_velocity(timestamps, 3600)
            v24h = _max_velocity(timestamps, 86400)

            # Round amount ratio
            round_count = sum(1 for a in amounts if _is_round_amount(a))
            round_ratio = round_count / max(1, len(amounts))

            # Age
            if len(timestamps) >= 2:
                age = (timestamps[-1] - timestamps[0]).total_seconds() / 86400
            else:
                age = 0.0

            # Amount statistics
            avg_amt = np.mean(amounts) if amounts else 0.0
            amt_var = np.var(amounts) if len(amounts) > 1 else 0.0

            features[addr] = {
                "tx_count": tx_count,
                "total_received": round(w["total_received"], 8),
                "total_sent": round(w["total_sent"], 8),
                "fan_in_degree": fan_in,
                "fan_out_degree": fan_out,
                "avg_tx_amount": round(float(avg_amt), 8),
                "amount_variance": round(float(amt_var), 8),
                "velocity_1h": v1h,
                "velocity_24h": v24h,
                "round_amount_ratio": round(round_ratio, 4),
                "unique_ips": len(w["ips"]),
                "unique_countries": len(w["countries"]),
                "age_days": round(age, 2),
                "first_seen": str(timestamps[0]) if timestamps else None,
                "last_seen": str(timestamps[-1]) if timestamps else None,
            }

        return features

    finally:
        if own_con:
            ctx.__exit__(None, None, None)


def save_features_to_db(features: dict[str, dict], con: duckdb.DuckDBPyConnection = None) -> int:
    """Save computed features to the wallet_features table."""
    own_con = con is None
    if own_con:
        ctx = get_db()
        con = ctx.__enter__()

    try:
        rows = []
        for addr, f in features.items():
            rows.append((
                addr,
                f["tx_count"],
                f["total_received"],
                f["total_sent"],
                f["fan_in_degree"],
                f["fan_out_degree"],
                f["avg_tx_amount"],
                f["amount_variance"],
                f["velocity_1h"],
                f["velocity_24h"],
                f["round_amount_ratio"],
                f["unique_ips"],
                f["unique_countries"],
                f["first_seen"],
                f["last_seen"],
                f["age_days"],
                None,  # cluster_id (set later)
                0.0,   # anomaly_score (set later)
                "Normal",  # risk_tier (set later)
            ))

        con.executemany("""
            INSERT OR REPLACE INTO wallet_features
            (address, tx_count, total_received, total_sent,
             fan_in_degree, fan_out_degree, avg_tx_amount, amount_variance,
             velocity_1h, velocity_24h, round_amount_ratio,
             unique_ips, unique_countries,
             first_seen, last_seen, age_days,
             cluster_id, anomaly_score, risk_tier)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::TIMESTAMP, ?::TIMESTAMP, ?, ?, ?, ?)
        """, rows)

        return len(rows)

    finally:
        if own_con:
            ctx.__exit__(None, None, None)


def features_to_matrix(features: dict[str, dict]) -> tuple[list[str], np.ndarray]:
    """Convert feature dict to (addresses, feature_matrix) for ML input."""
    addresses = list(features.keys())
    matrix = np.zeros((len(addresses), len(FEATURE_NAMES)))

    for i, addr in enumerate(addresses):
        for j, fname in enumerate(FEATURE_NAMES):
            matrix[i, j] = features[addr].get(fname, 0.0)

    return addresses, matrix


def _empty_wallet() -> dict:
    """Create an empty wallet activity record."""
    return {
        "tx_timestamps": [],
        "total_sent": 0.0,
        "total_received": 0.0,
        "amounts": [],
        "ips": set(),
        "countries": set(),
        "input_wallets": set(),
        "output_wallets": set(),
    }


def _max_velocity(timestamps: list, window_seconds: int) -> float:
    """Compute maximum number of transactions within a sliding time window."""
    if len(timestamps) < 2:
        return float(len(timestamps))

    from datetime import timedelta
    max_count = 1
    for i in range(len(timestamps)):
        count = 1
        for j in range(i + 1, len(timestamps)):
            if (timestamps[j] - timestamps[i]).total_seconds() <= window_seconds:
                count += 1
            else:
                break
        max_count = max(max_count, count)

    return float(max_count)


def _is_round_amount(amount: float) -> bool:
    """Check if an amount is a 'round' number (structuring indicator)."""
    round_values = {0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0}
    return amount in round_values or (amount > 0 and amount == round(amount, 0))
