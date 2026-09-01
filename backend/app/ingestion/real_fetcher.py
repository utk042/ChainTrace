"""
ChainTrace Forensics — Real Bitcoin Data Fetcher
Pulls genuine, independently-verifiable on-chain transactions from
Blockstream's public Esplora REST API (https://github.com/Blockstream/esplora,
free, no API key, no auth) and reshapes them into ChainTrace's ingestion
schema (the same shape as an uploaded CSV/JSON export).

Every txid this produces is real and can be checked on any block explorer
(blockstream.info, mempool.space, etc.) — this is not synthetic data.

Important limitation: real on-chain data has no network-layer (IP/port)
component. Bitcoin's peer-to-peer relay path for a given transaction isn't
public information — no one publishes "which IP announced which tx" in
bulk, because that's exactly the kind of telemetry that would defeat the
privacy the P2P layer tries to preserve. So src_ip/dst_ip/src_port/dst_port
are left unset (None) on every record this module produces. That's honest:
a real deployment would only have that column filled in by merging in the
operator's own node-level capture logs, which ChainTrace does not have
access to and will not fabricate. The rest of the pipeline (graph, ML,
GeoIP) already treats the network layer as optional for exactly this
reason — see app/models/transaction.py.
"""

import time
from datetime import datetime, timezone
from typing import Iterator, Optional

import httpx

from app.config import settings

# Esplora's scriptpubkey_type -> ChainTrace's script_type vocabulary.
SCRIPT_TYPE_MAP = {
    "p2pkh": "P2PKH",
    "p2sh": "P2SH",
    "v0_p2wpkh": "P2WPKH",
    "v0_p2wsh": "P2WSH",
    "v1_p2tr": "P2TR",
}


class EsploraError(RuntimeError):
    """Raised when the Esplora API can't be reached or returns something unusable."""


def _get(client: httpx.Client, path: str):
    url = f"{settings.ESPLORA_API_BASE}{path}"
    try:
        resp = client.get(url, timeout=settings.ESPLORA_REQUEST_TIMEOUT)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise EsploraError(f"Esplora request failed ({url}): {e}") from e
    time.sleep(settings.ESPLORA_REQUEST_DELAY)
    return resp


def _dominant_script_type(vout: list[dict]) -> str:
    """Pick the most common output script type, mapped to our vocabulary."""
    counts: dict[str, int] = {}
    for o in vout:
        t = SCRIPT_TYPE_MAP.get(o.get("scriptpubkey_type"))
        if t:
            counts[t] = counts.get(t, 0) + 1
    if not counts:
        return "P2PKH"
    return max(counts, key=counts.get)


def _transform_tx(tx: dict) -> Optional[dict]:
    """
    Reshape one Esplora transaction object into a ChainTrace ingestion record.
    Returns None for transactions we deliberately skip (coinbase — newly
    minted coins have no real "input wallet", so they don't fit a
    wallet-flow forensics model).
    """
    vin = tx.get("vin", [])
    vout = tx.get("vout", [])
    status = tx.get("status", {})

    if any(v.get("is_coinbase") for v in vin):
        return None
    if not status.get("confirmed") or not status.get("block_time"):
        return None

    input_addresses, input_amounts = [], []
    for v in vin:
        prevout = v.get("prevout") or {}
        addr = prevout.get("scriptpubkey_address")
        if not addr:
            continue  # non-standard/unspendable input we can't attribute
        input_addresses.append(addr)
        input_amounts.append(round(prevout.get("value", 0) / 1e8, 8))

    output_addresses, output_amounts = [], []
    for o in vout:
        addr = o.get("scriptpubkey_address")
        if not addr:
            continue  # e.g. OP_RETURN — not a wallet
        output_addresses.append(addr)
        output_amounts.append(round(o.get("value", 0) / 1e8, 8))

    if not input_addresses or not output_addresses:
        return None

    timestamp = datetime.fromtimestamp(status["block_time"], tz=timezone.utc).isoformat()

    return {
        "txid": tx["txid"],
        "timestamp": timestamp,
        # No network-layer telemetry for real on-chain data — see module docstring.
        "src_ip": None,
        "dst_ip": None,
        "src_port": None,
        "dst_port": None,
        "input_addresses": input_addresses,
        "output_addresses": output_addresses,
        "input_amounts": input_amounts,
        "output_amounts": output_amounts,
        "fee": round(tx.get("fee", 0) / 1e8, 8),
        "script_type": _dominant_script_type(vout),
    }


def fetch_recent_real_transactions(
    max_transactions: int = 1000,
    max_blocks: int = 10,
    start_height: Optional[int] = None,
) -> Iterator[dict]:
    """
    Walk backward from the chain tip (or `start_height`), pulling real,
    confirmed transactions block by block until `max_transactions` records
    have been yielded or `max_blocks` blocks have been scanned.

    Raises EsploraError if the API can't be reached — this requires
    outbound internet access to blockstream.info, which a fully air-gapped
    deployment won't have; run this step on a machine that does, then feed
    the resulting file to ChainTrace's normal offline ingest.
    """
    with httpx.Client(headers={"User-Agent": "ChainTrace-Forensics/1.0"}) as client:
        height = start_height
        if height is None:
            height = int(_get(client, "/blocks/tip/height").text)

        yielded = 0
        for _ in range(max_blocks):
            if yielded >= max_transactions or height < 0:
                break

            block_hash = _get(client, f"/block-height/{height}").text.strip()

            start_index = 0
            while yielded < max_transactions:
                txs = _get(client, f"/block/{block_hash}/txs/{start_index}").json()
                if not txs:
                    break
                for tx in txs:
                    record = _transform_tx(tx)
                    if record:
                        yield record
                        yielded += 1
                        if yielded >= max_transactions:
                            break
                if len(txs) < 25:
                    break  # last page for this block
                start_index += 25

            height -= 1
