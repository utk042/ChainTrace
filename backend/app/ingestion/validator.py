"""
ChainTrace Forensics — Data Validator
Validates raw records against Pydantic schemas, collecting errors.
"""

from typing import Iterable, Iterator
from pydantic import ValidationError
from app.models.transaction import TransactionRecord

# Every key the record schema knows how to store. Anything else in a file is
# reported rather than kept, because it has nowhere to go.
KNOWN_FIELDS = frozenset(TransactionRecord.model_fields.keys())


def validate_records(
    records: Iterable[dict],
) -> tuple[list[TransactionRecord], list[dict], dict]:
    """
    Validate raw dicts against TransactionRecord.

    Returns:
        valid:   validated TransactionRecord objects
        errors:  {record, error} for each row that failed
        report:  what the file contained, including columns that were not
                 recognised

    The report exists because Pydantic ignores unknown keys. A file carrying
    a column this schema does not declare used to validate with zero errors
    while that column was discarded in silence — the operator saw "0 errors"
    and had no way to learn that part of their evidence never made it into
    the database. Dropping the data is sometimes unavoidable; doing it
    quietly is not.
    """
    valid: list[TransactionRecord] = []
    errors: list[dict] = []
    seen_fields: set[str] = set()
    unknown_fields: set[str] = set()

    for raw in records:
        # `_label` is ground truth the synthetic generator attaches for
        # benchmarking; it is not part of the input schema.
        label = raw.pop("_label", None)

        for key in raw:
            seen_fields.add(key)
            if key not in KNOWN_FIELDS:
                unknown_fields.add(key)

        try:
            record = TransactionRecord(**{k: v for k, v in raw.items() if k in KNOWN_FIELDS})
            record._label = label
            valid.append(record)
        except ValidationError as e:
            errors.append({"record": raw, "error": str(e)})
        except Exception as e:
            errors.append({"record": raw, "error": f"Unexpected error: {str(e)}"})

    report = {
        "fields_seen": sorted(seen_fields),
        "unknown_fields": sorted(unknown_fields),
        # The schema's own required set, so an operator can see what a
        # conforming file looks like without reading the source.
        "recognised_fields": sorted(KNOWN_FIELDS),
        "missing_optional_fields": sorted(KNOWN_FIELDS - seen_fields - {"_label"}),
    }
    if unknown_fields:
        report["warning"] = (
            f"{len(unknown_fields)} column(s) in this file are not part of the "
            f"transaction schema and were not stored: {', '.join(sorted(unknown_fields))}."
        )

    return valid, errors, report
