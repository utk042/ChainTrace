"""
ChainTrace Forensics — logging.

Two reasons this module exists rather than `print()`:

1. `print()` raises. When the backend's stdout is a pipe whose reader has
   gone — the terminal that launched it was closed, a wrapper that captured
   its output exited, `uvicorn ... | tee` where tee died — the very next
   `print()` raises `BrokenPipeError: [Errno 32] Broken pipe`. Inside the
   ingest pipeline that exception was indistinguishable from a data error
   and killed the run: the whole analysis failed because a progress line
   could not be written. `logging` routes write failures through
   `Handler.handleError`, which never propagates, so a dead stdout can no
   longer take down an investigation.

2. There was nowhere to look afterwards. Everything went to a terminal that
   may not exist any more, with no traceback and no history, which is why a
   failed run could only ever say "Pipeline error: [Errno 32] Broken pipe".
   Records now also go to a rotating file under DATA_DIR/logs, and the last
   few hundred lines are kept in memory so the API can serve them to the
   Ingest page.
"""

import logging
import logging.handlers
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.config import settings

LOG_DIR = settings.DATA_DIR / "logs"
LOG_FILE = LOG_DIR / "chaintrace.log"

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# How many recent records the API can hand back. Enough for a full pipeline
# run with its traceback, small enough to never matter for memory.
RING_CAPACITY = 800

_configured = False
_configure_lock = Lock()


class RingBufferHandler(logging.Handler):
    """
    Keeps the most recent records in memory so `/api/ingest/logs` can serve
    them without the frontend needing filesystem access to the host.

    Records are stored already-formatted plus their structured fields, so a
    consumer can render either a plain log tail or a per-run view.
    """

    def __init__(self, capacity: int = RING_CAPACITY):
        super().__init__()
        self._records: deque[dict] = deque(maxlen=capacity)
        self._lock = Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts": datetime.fromtimestamp(record.created, tz=timezone.utc)
                        .isoformat(timespec="milliseconds"),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                # Set by pipeline code via `extra={"run_id": ...}` so the UI
                # can show only the run the operator is looking at.
                "run_id": getattr(record, "run_id", None),
                "stage": getattr(record, "stage", None),
            }
            if record.exc_info:
                entry["traceback"] = self.format(record).split("\n", 1)[-1]
            with self._lock:
                self._records.append(entry)
        except Exception:  # pragma: no cover - a logger must never raise
            self.handleError(record)

    def tail(self, limit: int = 200, run_id: str | None = None) -> list[dict]:
        with self._lock:
            records = list(self._records)
        if run_id:
            records = [r for r in records if r["run_id"] == run_id]
        return records[-limit:]

    def clear(self) -> None:
        with self._lock:
            self._records.clear()


ring_handler = RingBufferHandler()


def configure_logging(level: int = logging.INFO) -> None:
    """
    Install ChainTrace's handlers on the root logger. Idempotent, so calling
    it from both the app lifespan and a script is safe.
    """
    global _configured
    with _configure_lock:
        if _configured:
            return

        formatter = logging.Formatter(_FORMAT, datefmt=_DATE_FORMAT)
        root = logging.getLogger()
        root.setLevel(level)

        # Console. A StreamHandler swallows write errors, so this is the
        # handler that makes a dead stdout survivable.
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        root.addHandler(console)

        # File. Best-effort: a read-only or full filesystem must not stop the
        # backend from starting.
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(
                LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            root.addHandler(file_handler)
        except OSError as exc:
            console.handle(root.makeRecord(
                "chaintrace", logging.WARNING, __file__, 0,
                "File logging disabled (%s): %s", (LOG_FILE, exc), None,
            ))

        ring_handler.setFormatter(formatter)
        root.addHandler(ring_handler)

        # uvicorn installs its own handlers; letting them propagate as well
        # would double every access line.
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            logging.getLogger(name).propagate = False

        _configured = True


def get_logger(name: str) -> logging.Logger:
    """A configured logger. Use `app.<module>` style names."""
    configure_logging()
    return logging.getLogger(name)


def log_tail(limit: int = 200, run_id: str | None = None) -> list[dict]:
    """Recent log records, newest last."""
    return ring_handler.tail(limit=limit, run_id=run_id)


def log_file_path() -> str:
    return str(LOG_FILE)
