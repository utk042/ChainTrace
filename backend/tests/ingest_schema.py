"""
Input-schema acceptance test.

The required dataset has fourteen fields:

    timestamp, src_ip, dst_ip, src_port, dst_port, txid,
    input_addresses[], output_addresses[], input_amounts[], output_amounts[],
    fee, script_type, geo_country, asn

This proves the parser and the record schema accept all fourteen, in every
format the ingest supports, and that each one survives to the database and
back out through the API.

It exists because the previous behaviour was the worst kind of failure. A
conforming file validated with "0 errors" while `geo_country` and `asn` were
discarded: the record schema declared `geo_country_src`/`geo_country_dst` and
`asn_src`/`asn_dst` instead, and Pydantic ignores keys it does not know. The
operator saw a clean ingest and two columns of their evidence were gone.
Nothing warned them, and nothing here would have caught it.

Run: python tests/ingest_schema.py   (from backend/, with deps installed)
"""

import csv
import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

REQUIRED_FIELDS = [
    "timestamp", "src_ip", "dst_ip", "src_port", "dst_port", "txid",
    "input_addresses", "output_addresses", "input_amounts", "output_amounts",
    "fee", "script_type", "geo_country", "asn",
]

ARRAY_FIELDS = {"input_addresses", "output_addresses", "input_amounts", "output_amounts"}

FAILURES = []


def check(ok, label, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail else ''}", flush=True)
    if not ok:
        FAILURES.append(label)


def sample_row(i: int) -> dict:
    return {
        "timestamp": f"2023-10-0{i % 9 + 1} 12:{i % 60:02d}:00",
        "src_ip": f"198.51.100.{i % 254 + 1}",
        "dst_ip": f"203.0.113.{i % 254 + 1}",
        "src_port": 8333,
        "dst_port": 8333 + (i % 3),
        "txid": f"{i:064x}",
        "input_addresses": [f"bc1qsender{i:022d}"],
        "output_addresses": [f"bc1qrecv{i:024d}", f"bc1qchange{i:022d}"],
        "input_amounts": [1.5 + i / 100],
        "output_amounts": [1.0, 0.49 + i / 100],
        "fee": 0.0001 * (i % 7 + 1),
        "script_type": ["P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"][i % 5],
        "geo_country": ["IN", "SG", "DE", "US"][i % 4],
        "asn": f"AS{9000 + i}",
    }


def as_csv(rows) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=REQUIRED_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: (json.dumps(v) if k in ARRAY_FIELDS else v) for k, v in row.items()})
    return buf.getvalue()


def as_json(rows) -> str:
    return json.dumps(rows, indent=1)


def as_xml(rows) -> str:
    parts = ["<transactions>"]
    for row in rows:
        parts.append("  <transaction>")
        for key in REQUIRED_FIELDS:
            value = row[key]
            if key in ARRAY_FIELDS:
                items = "".join(f"<item>{v}</item>" for v in value)
                parts.append(f"    <{key}>{items}</{key}>")
            else:
                parts.append(f"    <{key}>{value}</{key}>")
        parts.append("  </transaction>")
    parts.append("</transactions>")
    return "\n".join(parts)


def main():
    work = Path(tempfile.mkdtemp(prefix="chaintrace-schema-"))
    os.environ.setdefault("CT_DATA_DIR", str(work))
    os.environ.setdefault("CT_DUCKDB_PATH", str(work / "schema.duckdb"))
    os.environ.setdefault("CT_MODELS_DIR", str(work / "models"))
    os.environ.setdefault("CT_LIGHT_MODE", "true")
    for sub in ("sample", "uploads", "models", "logs"):
        (work / sub).mkdir(parents=True, exist_ok=True)

    import logging
    logging.disable(logging.INFO)

    from app.ingestion.parser import parse_file
    from app.ingestion.validator import validate_records, KNOWN_FIELDS
    from app.models.transaction import TransactionRecord

    # ── 1. The schema declares every required field ──────────────────
    missing = [f for f in REQUIRED_FIELDS if f not in TransactionRecord.model_fields]
    check(not missing, "the record schema declares every required field",
          f"missing: {missing}" if missing else f"{len(REQUIRED_FIELDS)} fields")

    rows = [sample_row(i) for i in range(1, 26)]

    # ── 2. Every supported format round-trips all fourteen ───────────
    for suffix, render in ((".csv", as_csv), (".json", as_json), (".xml", as_xml)):
        path = work / f"required{suffix}"
        path.write_text(render(rows))

        valid, errors, report = validate_records(parse_file(path))
        check(len(valid) == len(rows) and not errors,
              f"{suffix[1:].upper()} in the required schema validates",
              f"{len(valid)} valid, {len(errors)} rejected"
              + (f"; first: {str(errors[0]['error'])[:120]}" if errors else ""))
        check(not report["unknown_fields"],
              f"{suffix[1:].upper()} has no unrecognised columns",
              ", ".join(report["unknown_fields"]))

        if not valid:
            continue
        record = valid[0]
        lost = [f for f in REQUIRED_FIELDS if getattr(record, f, None) in (None, [], "")]
        check(not lost, f"{suffix[1:].upper()} preserves every field's value",
              f"empty after parse: {lost}" if lost else "14/14 populated")

    # ── 3. A supplied country/ASN is kept, and is not overwritten ────
    valid, _, _ = validate_records(parse_file(work / "required.csv"))
    record = valid[0]
    check(record.geo_country == rows[0]["geo_country"] and record.asn == rows[0]["asn"],
          "the supplied country and ASN are stored as given",
          f"{record.geo_country} / {record.asn}")
    check(record.geo_country_src == record.geo_country and record.asn_src == record.asn,
          "a supplied value seeds the source endpoint")

    from app.ingestion.enricher import get_enricher
    enriched = get_enricher().enrich_record(record)
    check(enriched.geo_country == rows[0]["geo_country"]
          and enriched.geo_country_src == rows[0]["geo_country"],
          "GeoIP enrichment does not overwrite a supplied value",
          f"{enriched.geo_country_src}")

    # ── 4. An unrecognised column is reported, not silently dropped ──
    extra = [dict(r, operator_case_ref=f"CASE-{i}") for i, r in enumerate(rows[:3])]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=REQUIRED_FIELDS + ["operator_case_ref"])
    writer.writeheader()
    for row in extra:
        writer.writerow({k: (json.dumps(v) if k in ARRAY_FIELDS else v) for k, v in row.items()})
    path = work / "extra.csv"
    path.write_text(buf.getvalue())

    valid, errors, report = validate_records(parse_file(path))
    check(len(valid) == 3 and not errors,
          "a file with an extra column is still accepted", f"{len(valid)} valid")
    check(report["unknown_fields"] == ["operator_case_ref"],
          "the extra column is named in the report", str(report["unknown_fields"]))
    check("not stored" in (report.get("warning") or ""),
          "the report says plainly that it was not stored", report.get("warning"))

    # ── 5. All the way to the database and back out ──────────────────
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        run = client.post("/api/ingest/run", params={"file_path": str(work / "required.csv")})
        check(run.status_code == 200, "the pipeline accepts the required schema", str(run.status_code))

        deadline = time.time() + 600
        status = {}
        while time.time() < deadline:
            status = client.get("/api/ingest/status").json()
            if status.get("status") in ("completed", "failed"):
                break
            time.sleep(2)
        check(status.get("status") == "completed", "the pipeline completes on it",
              f"{status.get('status')}: {status.get('message')}")

        listing = client.get("/api/transactions?page=1&page_size=5").json()
        check(listing.get("total", 0) == len(rows), "every record reached the database",
              f"{listing.get('total')} of {len(rows)}")

        stored = listing["transactions"][0]
        by_txid = {r["txid"]: r for r in rows}
        original = by_txid.get(stored["txid"])
        check(original is not None, "a stored row can be matched to its input")
        if original:
            mismatched = []
            for field in REQUIRED_FIELDS:
                if field == "timestamp":
                    continue  # normalised to a datetime on the way in
                if stored.get(field) != original[field]:
                    mismatched.append(f"{field}: {stored.get(field)!r} != {original[field]!r}")
            check(not mismatched, "the API returns every field as it was supplied",
                  "; ".join(mismatched) if mismatched else "13/13 match (timestamp normalised)")

        detail = client.get(f"/api/transactions/{stored['txid']}").json()
        check(detail.get("geo_country") == original["geo_country"]
              and detail.get("asn") == original["asn"],
              "the detail endpoint carries the supplied attribution",
              f"{detail.get('geo_country')} / {detail.get('asn')}")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:\n  - " + "\n  - ".join(FAILURES))
        return 1
    print(f"The ingest accepts the complete required schema "
          f"({len(REQUIRED_FIELDS)} fields, CSV/JSON/XML).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
