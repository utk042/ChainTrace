"""
ChainTrace Forensics — Data Parser
Detects file format (CSV/JSON/XML) and streams records as dicts.
"""

import csv
import json
import io
from pathlib import Path
from typing import Iterator
from lxml import etree


def detect_format(file_path: str | Path) -> str:
    """Detect file format from extension or content sniffing."""
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext == ".csv":
        return "csv"
    elif ext in (".json", ".jsonl"):
        return "json"
    elif ext in (".xml",):
        return "xml"

    # Content sniffing
    with open(path, "r") as f:
        first_chars = f.read(100).strip()
        if first_chars.startswith("{") or first_chars.startswith("["):
            return "json"
        elif first_chars.startswith("<?xml") or first_chars.startswith("<"):
            return "xml"
        else:
            return "csv"


def parse_csv(file_path: str | Path) -> Iterator[dict]:
    """Parse CSV file, handling JSON-encoded array fields."""
    with open(file_path, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield _normalize_row(row)


def parse_csv_content(content: str) -> Iterator[dict]:
    """Parse CSV content string."""
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        yield _normalize_row(row)


def parse_json(file_path: str | Path) -> Iterator[dict]:
    """Parse JSON file (array of objects or newline-delimited)."""
    with open(file_path, "r") as f:
        content = f.read().strip()

    if content.startswith("["):
        data = json.loads(content)
        for record in data:
            yield _normalize_row(record)
    else:
        # Newline-delimited JSON
        for line in content.split("\n"):
            line = line.strip()
            if line:
                yield _normalize_row(json.loads(line))


def parse_json_content(content: str) -> Iterator[dict]:
    """Parse JSON content string."""
    content = content.strip()
    if content.startswith("["):
        data = json.loads(content)
        for record in data:
            yield _normalize_row(record)
    else:
        for line in content.split("\n"):
            line = line.strip()
            if line:
                yield _normalize_row(json.loads(line))


def parse_xml(file_path: str | Path) -> Iterator[dict]:
    """Parse XML file with <transaction> elements."""
    tree = etree.parse(str(file_path))
    root = tree.getroot()

    for tx_elem in root.iter("transaction"):
        record = {}
        for child in tx_elem:
            tag = child.tag
            text = child.text or ""

            # Handle array elements
            if tag in ("input_addresses", "output_addresses",
                       "input_amounts", "output_amounts"):
                items = [item.text for item in child.iter("item") if item.text]
                if tag.endswith("amounts"):
                    record[tag] = [float(x) for x in items]
                else:
                    record[tag] = items
            else:
                record[tag] = text.strip()

        yield _normalize_row(record)


def parse_xml_content(content: str) -> Iterator[dict]:
    """Parse XML content string."""
    root = etree.fromstring(content.encode())
    for tx_elem in root.iter("transaction"):
        record = {}
        for child in tx_elem:
            tag = child.tag
            text = child.text or ""
            if tag in ("input_addresses", "output_addresses",
                       "input_amounts", "output_amounts"):
                items = [item.text for item in child.iter("item") if item.text]
                if tag.endswith("amounts"):
                    record[tag] = [float(x) for x in items]
                else:
                    record[tag] = items
            else:
                record[tag] = text.strip()
        yield _normalize_row(record)


def parse_file(file_path: str | Path) -> Iterator[dict]:
    """Auto-detect format and parse file."""
    fmt = detect_format(file_path)
    if fmt == "csv":
        yield from parse_csv(file_path)
    elif fmt == "json":
        yield from parse_json(file_path)
    elif fmt == "xml":
        yield from parse_xml(file_path)
    else:
        raise ValueError(f"Unsupported file format: {fmt}")


def _normalize_row(row: dict) -> dict:
    """Normalize a row dict: parse JSON-encoded arrays, cast types."""
    result = {}

    for key, value in row.items():
        if key.startswith("_"):
            result[key] = value
            continue

        # Parse JSON-encoded arrays
        if key in ("input_addresses", "output_addresses"):
            if isinstance(value, str):
                try:
                    result[key] = json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    result[key] = [v.strip() for v in value.split(",") if v.strip()]
            elif isinstance(value, list):
                result[key] = value
            else:
                result[key] = []

        elif key in ("input_amounts", "output_amounts"):
            if isinstance(value, str):
                try:
                    parsed = json.loads(value)
                    result[key] = [float(x) for x in parsed]
                except (json.JSONDecodeError, ValueError):
                    result[key] = [float(x) for x in value.split(",") if x.strip()]
            elif isinstance(value, list):
                result[key] = [float(x) for x in value]
            else:
                result[key] = []

        elif key in ("src_port", "dst_port"):
            if value in (None, ""):
                result[key] = None
            else:
                try:
                    result[key] = int(value)
                except (ValueError, TypeError):
                    result[key] = None

        elif key in ("src_ip", "dst_ip"):
            result[key] = value if value else None

        elif key == "fee":
            try:
                result[key] = float(value)
            except (ValueError, TypeError):
                result[key] = 0.0

        else:
            result[key] = value

    return result
