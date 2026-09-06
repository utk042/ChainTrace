"""
ChainTrace Forensics — Analyst Notes Router

Findings an analyst records against an entity: what they concluded about a
wallet, a transaction or an address, and why.

These are case material, which is why they are here and not in the browser.
A note in localStorage is lost when someone clears their cache, is invisible
to a second analyst on the same data, and does not appear in an export — for
a record that may end up justifying a decision, that is worse than no note.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.database import get_db, get_db_readonly
from app.logging_config import get_logger

logger = get_logger("app.routers.notes")

router = APIRouter(prefix="/api/notes", tags=["Notes"])

# Long enough for a real finding, bounded so one note cannot be used to load
# the database with arbitrary content.
MAX_BODY = 8000
MAX_AUTHOR = 120


class NoteIn(BaseModel):
    entity_id: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=MAX_BODY)
    entity_type: Optional[str] = Field(default=None, max_length=40)
    author: Optional[str] = Field(default=None, max_length=MAX_AUTHOR)


class NoteUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY)
    author: Optional[str] = Field(default=None, max_length=MAX_AUTHOR)


def _row_to_note(r) -> dict:
    return {
        "note_id": r[0],
        "entity_id": r[1],
        "entity_type": r[2],
        "body": r[3],
        "author": r[4],
        "created_at": str(r[5]) if r[5] else None,
        "updated_at": str(r[6]) if r[6] else None,
    }


_COLUMNS = "note_id, entity_id, entity_type, body, author, created_at, updated_at"


@router.get("")
def list_notes(
    entity_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=2000),
):
    """Notes for one entity, or the most recent across the case."""
    with get_db_readonly() as con:
        if entity_id:
            rows = con.execute(
                f"SELECT {_COLUMNS} FROM entity_notes WHERE entity_id = ? "
                f"ORDER BY created_at DESC LIMIT ?",
                [entity_id, limit],
            ).fetchall()
        else:
            rows = con.execute(
                f"SELECT {_COLUMNS} FROM entity_notes ORDER BY created_at DESC LIMIT ?",
                [limit],
            ).fetchall()
        return {"notes": [_row_to_note(r) for r in rows], "total": len(rows)}


@router.get("/counts")
def note_counts():
    """
    How many notes each annotated entity carries.

    One request, so the canvas can mark every annotated node without asking
    per node — with a thousand nodes on screen that would be a thousand
    requests to draw one badge.
    """
    with get_db_readonly() as con:
        rows = con.execute(
            "SELECT entity_id, COUNT(*) FROM entity_notes GROUP BY entity_id"
        ).fetchall()
        return {"counts": {r[0]: r[1] for r in rows}}


@router.post("")
def create_note(note: NoteIn):
    """Record a finding against an entity."""
    body = note.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="A note cannot be empty.")

    now = datetime.now(timezone.utc)
    note_id = f"NOTE-{uuid.uuid4().hex[:12].upper()}"
    with get_db() as con:
        con.execute(
            "INSERT INTO entity_notes "
            "(note_id, entity_id, entity_type, body, author, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [note_id, note.entity_id, note.entity_type, body,
             (note.author or "").strip() or None, now, now],
        )
    logger.info("Note %s recorded against %s", note_id, note.entity_id)
    return {
        "note_id": note_id, "entity_id": note.entity_id,
        "entity_type": note.entity_type, "body": body,
        "author": note.author, "created_at": str(now), "updated_at": str(now),
    }


@router.put("/{note_id}")
def update_note(note_id: str, note: NoteUpdate):
    """Revise a finding."""
    body = note.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="A note cannot be empty.")

    now = datetime.now(timezone.utc)
    with get_db() as con:
        existing = con.execute(
            "SELECT 1 FROM entity_notes WHERE note_id = ?", [note_id]
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"No note '{note_id}'.")
        con.execute(
            "UPDATE entity_notes SET body = ?, author = ?, updated_at = ? WHERE note_id = ?",
            [body, (note.author or "").strip() or None, now, note_id],
        )
        row = con.execute(
            f"SELECT {_COLUMNS} FROM entity_notes WHERE note_id = ?", [note_id]
        ).fetchone()
    return _row_to_note(row)


@router.delete("/{note_id}")
def delete_note(note_id: str):
    """Remove a finding. Deliberate and explicit; nothing deletes notes for you."""
    with get_db() as con:
        existing = con.execute(
            "SELECT 1 FROM entity_notes WHERE note_id = ?", [note_id]
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"No note '{note_id}'.")
        con.execute("DELETE FROM entity_notes WHERE note_id = ?", [note_id])
    logger.info("Note %s deleted", note_id)
    return {"deleted": note_id}
