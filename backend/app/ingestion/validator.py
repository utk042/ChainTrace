"""
ChainTrace Forensics — Data Validator
Validates raw records against Pydantic schemas, collecting errors.
"""

from typing import Iterator
from pydantic import ValidationError
from app.models.transaction import TransactionRecord


def validate_records(
    records: Iterator[dict],
) -> tuple[list[TransactionRecord], list[dict]]:
    """
    Validate an iterator of raw dicts against TransactionRecord schema.

    Returns:
        valid: List of validated TransactionRecord objects
        errors: List of {record, error} dicts for failed validations
    """
    valid = []
    errors = []

    for raw in records:
        try:
            # Strip internal label before validation
            label = raw.pop("_label", None)

            record = TransactionRecord(**raw)

            # Re-attach label for downstream use
            record._label = label

            valid.append(record)
        except ValidationError as e:
            errors.append({
                "record": raw,
                "error": str(e),
            })
        except Exception as e:
            errors.append({
                "record": raw,
                "error": f"Unexpected error: {str(e)}",
            })

    return valid, errors
