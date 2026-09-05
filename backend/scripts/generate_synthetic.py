#!/usr/bin/env python3
"""
ChainTrace Forensics — Synthetic Bitcoin Transaction Dataset Generator

Generates a realistic synthetic dataset with 6 embedded anomaly patterns:
  1. Normal P2P transfers (~85%)
  2. Peeling chains (~4%)
  3. Mixer/Tumbler patterns (~3%)
  4. Velocity spikes (~3%)
  5. Round-amount structuring (~3%)
  6. Darknet proximity (~2%)

Usage:
    python generate_synthetic.py --count 5000 --output data/sample/transactions.csv
"""

import argparse
import csv
import json
import random
import hashlib
import ipaddress
from datetime import datetime, timedelta
from pathlib import Path

from app.logging_config import get_logger

logger = get_logger("scripts.generate_synthetic")


# ── Constants ─────────────────────────────────────────────────────────────────

SCRIPT_TYPES = ["P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"]

# Geo/ASN pools (synthetic)
COUNTRIES = ["US", "RU", "CN", "DE", "NL", "RO", "UA", "BR", "IN", "GB",
             "FR", "JP", "KR", "IR", "NG", "VN", "CZ", "SE", "CH", "SG"]
ASNS = [f"AS{random.randint(1000, 65000)}" for _ in range(100)]

# Suspicious countries (higher weight for anomalous patterns)
HIGH_RISK_COUNTRIES = ["RU", "IR", "RO", "UA", "NG", "VN"]

# Pre-labeled darknet-adjacent wallets
DARKNET_WALLETS = [f"1Dark{hashlib.md5(str(i).encode()).hexdigest()[:24]}" for i in range(20)]

# Time range
START_TIME = datetime(2023, 10, 1, 0, 0, 0)
END_TIME = datetime(2023, 11, 1, 0, 0, 0)
TIME_RANGE_SECONDS = int((END_TIME - START_TIME).total_seconds())


# ── Helpers ───────────────────────────────────────────────────────────────────

def random_txid() -> str:
    """Generate a random 64-char hex transaction ID."""
    return hashlib.sha256(random.randbytes(32)).hexdigest()


def random_wallet(prefix: str = "bc1q") -> str:
    """Generate a random Bitcoin-like wallet address."""
    suffix = hashlib.md5(random.randbytes(16)).hexdigest()[:28]
    return f"{prefix}{suffix}"


def random_ip(private: bool = False) -> str:
    """Generate a random IP address."""
    if private:
        return f"192.168.{random.randint(1, 254)}.{random.randint(1, 254)}"
    while True:
        ip = str(ipaddress.IPv4Address(random.randint(16777216, 3758096383)))
        if not ipaddress.IPv4Address(ip).is_private:
            return ip


def random_port() -> int:
    """Random port (Bitcoin default 8333 weighted)."""
    return random.choices([8333, random.randint(1024, 65535)], weights=[0.7, 0.3])[0]


def random_timestamp() -> datetime:
    """Random timestamp within the time range."""
    offset = random.randint(0, TIME_RANGE_SECONDS)
    return START_TIME + timedelta(seconds=offset)


def random_amount(min_btc: float = 0.0001, max_btc: float = 5.0) -> float:
    """Random BTC amount with realistic distribution."""
    # Log-normal distribution (most transactions are small)
    amount = random.lognormvariate(-2, 1.5)
    return round(max(min_btc, min(max_btc, amount)), 8)


# ── Pattern Generators ────────────────────────────────────────────────────────

def generate_normal_tx() -> dict:
    """Normal P2P transaction: 1-3 inputs, 1-2 outputs."""
    n_inputs = random.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0]
    n_outputs = random.choices([1, 2], weights=[0.4, 0.6])[0]

    input_addrs = [random_wallet() for _ in range(n_inputs)]
    output_addrs = [random_wallet() for _ in range(n_outputs)]
    input_amts = [random_amount() for _ in range(n_inputs)]
    total_in = sum(input_amts)
    fee = round(total_in * random.uniform(0.001, 0.02), 8)
    total_out = round(total_in - fee, 8)

    if n_outputs == 1:
        output_amts = [total_out]
    else:
        split = random.uniform(0.1, 0.9)
        output_amts = [round(total_out * split, 8), round(total_out * (1 - split), 8)]

    return _build_record(input_addrs, output_addrs, input_amts, output_amts, fee, "normal")


def generate_peeling_chain(chain_length: int = 5) -> list[dict]:
    """Peeling chain: sequential 1→2 splits where one output is tiny change."""
    records = []
    current_wallet = random_wallet()
    current_amount = random_amount(1.0, 10.0)
    base_time = random_timestamp()
    src_ip = random_ip()

    for i in range(chain_length):
        peel_amount = round(current_amount * random.uniform(0.01, 0.1), 8)
        change = round(current_amount - peel_amount - random.uniform(0.00001, 0.0005), 8)
        next_wallet = random_wallet()
        peel_wallet = random_wallet()
        fee = round(current_amount - peel_amount - change, 8)

        ts = base_time + timedelta(minutes=random.randint(5, 30) * (i + 1))
        record = _build_record(
            [current_wallet], [peel_wallet, next_wallet],
            [current_amount], [peel_amount, max(0.0001, change)],
            max(0.00001, fee), "peeling_chain",
            timestamp=ts, src_ip=src_ip
        )
        records.append(record)
        current_wallet = next_wallet
        current_amount = max(0.001, change)

    return records


def generate_mixer_pattern(fan_in: int = 15, fan_out: int = 10) -> list[dict]:
    """Mixer/Tumbler: many wallets → consolidation → fan-out."""
    records = []
    base_time = random_timestamp()
    consolidation_wallet = random_wallet("1Mix")
    src_ip = random_ip()

    # Fan-in phase: many small deposits to consolidation
    total_deposited = 0.0
    for i in range(fan_in):
        amount = random_amount(0.1, 2.0)
        total_deposited += amount
        fee = round(amount * 0.005, 8)
        ts = base_time + timedelta(minutes=random.randint(1, 60))
        record = _build_record(
            [random_wallet()], [consolidation_wallet],
            [amount], [round(amount - fee, 8)],
            fee, "mixer",
            timestamp=ts, src_ip=src_ip,
            country=random.choice(HIGH_RISK_COUNTRIES)
        )
        records.append(record)

    # Fan-out phase: consolidation → many outputs
    remaining = total_deposited * 0.98  # 2% mixer fee
    for i in range(fan_out):
        if i == fan_out - 1:
            amount = round(remaining, 8)
        else:
            amount = round(remaining / fan_out * random.uniform(0.8, 1.2), 8)
            remaining -= amount

        fee = round(amount * 0.003, 8)
        ts = base_time + timedelta(hours=2, minutes=random.randint(1, 60))
        record = _build_record(
            [consolidation_wallet], [random_wallet()],
            [max(0.0001, amount + fee)], [max(0.0001, amount)],
            max(0.00001, fee), "mixer",
            timestamp=ts, src_ip=src_ip,
            country=random.choice(HIGH_RISK_COUNTRIES)
        )
        records.append(record)

    return records


def generate_velocity_spike(wallet: str = None, count: int = 60) -> list[dict]:
    """Velocity spike: single wallet bursts 50+ tx in <1hr."""
    records = []
    wallet = wallet or random_wallet("1Vel")
    base_time = random_timestamp()
    src_ip = random_ip()

    for i in range(count):
        amount = random_amount(0.01, 0.5)
        fee = round(amount * 0.01, 8)
        ts = base_time + timedelta(seconds=random.randint(0, 3600))
        record = _build_record(
            [wallet], [random_wallet()],
            [amount], [round(amount - fee, 8)],
            fee, "velocity_spike",
            timestamp=ts, src_ip=src_ip
        )
        records.append(record)

    return records


def generate_round_amount_tx() -> dict:
    """Structuring: exact round BTC amounts."""
    round_amounts = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0]
    amount = random.choice(round_amounts)
    fee = round(amount * 0.005, 8)

    return _build_record(
        [random_wallet()], [random_wallet()],
        [amount], [round(amount - fee, 8)],
        fee, "round_amount"
    )


def generate_darknet_tx() -> dict:
    """Darknet proximity: wallet interacts with known darknet addresses."""
    darknet_wallet = random.choice(DARKNET_WALLETS)
    user_wallet = random_wallet()
    amount = random_amount(0.05, 3.0)
    fee = round(amount * 0.01, 8)

    # 50% chance the darknet wallet is input vs output
    if random.random() > 0.5:
        inputs, outputs = [user_wallet], [darknet_wallet]
    else:
        inputs, outputs = [darknet_wallet], [user_wallet]

    return _build_record(
        inputs, outputs,
        [amount], [round(amount - fee, 8)],
        fee, "darknet_proximity",
        country=random.choice(HIGH_RISK_COUNTRIES)
    )


def _build_record(
    input_addrs: list[str],
    output_addrs: list[str],
    input_amts: list[float],
    output_amts: list[float],
    fee: float,
    label: str,
    timestamp: datetime = None,
    src_ip: str = None,
    country: str = None,
) -> dict:
    """Build a transaction record dict."""
    ts = timestamp or random_timestamp()
    src = src_ip or random_ip()
    dst = random_ip()
    country_src = country or random.choice(COUNTRIES)
    country_dst = random.choice(COUNTRIES)

    return {
        "txid": random_txid(),
        "timestamp": ts.isoformat(),
        "src_ip": src,
        "dst_ip": dst,
        "src_port": random_port(),
        "dst_port": random_port(),
        "input_addresses": input_addrs,
        "output_addresses": output_addrs,
        "input_amounts": input_amts,
        "output_amounts": output_amts,
        "fee": fee,
        "script_type": random.choice(SCRIPT_TYPES),
        "geo_country_src": country_src,
        "geo_country_dst": country_dst,
        "asn_src": random.choice(ASNS),
        "asn_dst": random.choice(ASNS),
        "_label": label,
    }


# ── Main Generator ───────────────────────────────────────────────────────────

def generate_dataset(total: int = 5000, seed: int = 42) -> list[dict]:
    """Generate a full synthetic dataset with embedded anomaly patterns."""
    random.seed(seed)

    records = []

    # Calculate pattern counts
    n_peeling = int(total * 0.04)
    n_mixer = int(total * 0.03)
    n_velocity = int(total * 0.03)
    n_round = int(total * 0.03)
    n_darknet = int(total * 0.02)
    n_normal = total - n_peeling - n_mixer - n_velocity - n_round - n_darknet

    # Generate normal transactions
    for _ in range(n_normal):
        records.append(generate_normal_tx())

    # Generate peeling chains (each chain produces ~5 tx)
    chains_needed = max(1, n_peeling // 5)
    for _ in range(chains_needed):
        records.extend(generate_peeling_chain(chain_length=5))

    # Generate mixer patterns (each produces ~25 tx)
    mixers_needed = max(1, n_mixer // 25)
    for _ in range(mixers_needed):
        records.extend(generate_mixer_pattern(fan_in=15, fan_out=10))

    # Generate velocity spikes (each produces ~60 tx)
    spikes_needed = max(1, n_velocity // 60)
    for _ in range(spikes_needed):
        records.extend(generate_velocity_spike(count=60))

    # Generate round-amount transactions
    for _ in range(n_round):
        records.append(generate_round_amount_tx())

    # Generate darknet proximity transactions
    for _ in range(n_darknet):
        records.append(generate_darknet_tx())

    # Shuffle and trim to exact count
    random.shuffle(records)
    records = records[:total]

    # Sort by timestamp
    records.sort(key=lambda r: r["timestamp"])

    return records


def save_csv(records: list[dict], output_path: Path) -> None:
    """Save records to CSV (arrays serialized as JSON strings)."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "txid", "timestamp", "src_ip", "dst_ip", "src_port", "dst_port",
        "input_addresses", "output_addresses", "input_amounts", "output_amounts",
        "fee", "script_type", "geo_country_src", "geo_country_dst",
        "asn_src", "asn_dst", "_label"
    ]

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            row = record.copy()
            # Serialize lists as JSON strings for CSV compatibility
            row["input_addresses"] = json.dumps(row["input_addresses"])
            row["output_addresses"] = json.dumps(row["output_addresses"])
            row["input_amounts"] = json.dumps(row["input_amounts"])
            row["output_amounts"] = json.dumps(row["output_amounts"])
            writer.writerow(row)

    logger.info(f"Saved {len(records)} records to {output_path}")


def save_json(records: list[dict], output_path: Path) -> None:
    """Save records as JSON array."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(records, f, indent=2, default=str)

    logger.info(f"Saved {len(records)} records to {output_path}")


def print_stats(records: list[dict]) -> None:
    """Print dataset statistics."""
    from collections import Counter
    labels = Counter(r["_label"] for r in records)
    wallets = set()
    ips = set()
    for r in records:
        wallets.update(r["input_addresses"])
        wallets.update(r["output_addresses"])
        ips.add(r["src_ip"])
        ips.add(r["dst_ip"])

    logger.info("ChainTrace Synthetic Dataset Statistics")
    logger.info(f"Total transactions:  {len(records)}")
    logger.info(f"Unique wallets:      {len(wallets)}")
    logger.info(f"Unique IPs:          {len(ips)}")
    logger.info(f"Label distribution:")
    for label, count in sorted(labels.items(), key=lambda x: -x[1]):
        pct = count / len(records) * 100
        logger.info(f"{label:20s}  {count:5d}  ({pct:.1f}%)")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic Bitcoin transaction dataset")
    parser.add_argument("--count", type=int, default=5000, help="Number of transactions")
    parser.add_argument("--output", type=str, default="data/sample/transactions.csv", help="Output file path")
    parser.add_argument("--format", choices=["csv", "json", "both"], default="both", help="Output format")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    records = generate_dataset(total=args.count, seed=args.seed)
    print_stats(records)

    output_path = Path(args.output)

    if args.format in ("csv", "both"):
        csv_path = output_path.with_suffix(".csv")
        save_csv(records, csv_path)

    if args.format in ("json", "both"):
        json_path = output_path.with_suffix(".json")
        save_json(records, json_path)
