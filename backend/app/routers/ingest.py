"""
ChainTrace Forensics — Ingest Router
File upload and pipeline execution endpoints.
"""

import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, HTTPException, Query
from app.config import settings
from app.database import get_db
from app.logging_config import get_logger, log_tail, log_file_path
from app.ingestion.parser import parse_file
from app.ingestion.validator import validate_records
from app.ingestion.enricher import get_enricher
from app.ingestion.loader import load_transactions, clear_all_data
from app.ingestion.real_fetcher import fetch_recent_real_transactions, EsploraError
from app.ml.trainer import run_full_pipeline

logger = get_logger("app.routers.ingest")

router = APIRouter(prefix="/api/ingest", tags=["Ingest"])

# The pipeline's stages, in order, with the progress each one starts at.
# The frontend renders exactly these, so a failure is attributed to the stage
# that actually failed. Previously the status carried a bare progress number
# that was reset to 0 on error, which made every failure — including one in
# the ML stage twenty minutes in — light up "PARSE & VALIDATE" as the culprit.
STAGES = [
    ("clear", "Clear existing data", 5),
    ("parse", "Parse data file", 10),
    ("validate", "Validate records", 20),
    ("enrich", "Enrich with GeoIP", 30),
    ("load", "Load into DuckDB", 40),
    ("analyse", "Run ML analysis", 50),
]
STAGE_ORDER = [key for key, _, _ in STAGES]

# Pipeline state. Guarded because it is written from the background worker
# thread and read by every /status poll.
_status_lock = threading.Lock()
_pipeline_status = {
    "status": "idle",
    "progress": 0,
    "message": "",
    "run_id": None,
    "stage": None,
    "stages": [],
    "error": None,
    "error_type": None,
    "traceback": None,
    "started_at": None,
    "finished_at": None,
}


def _initial_stages() -> list[dict]:
    return [
        {"key": key, "label": label, "status": "pending", "detail": None}
        for key, label, _ in STAGES
    ]


def _set_status(**fields) -> None:
    with _status_lock:
        _pipeline_status.update(fields)


def _get_status() -> dict:
    with _status_lock:
        return dict(_pipeline_status)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class _Run:
    """
    One pipeline execution: stage bookkeeping plus run-tagged logging.

    Every message is logged with the run id, so `/api/ingest/logs` can serve
    the log for one run rather than the whole process, and so a run that
    failed hours ago can still be read back.
    """

    def __init__(self, run_id: str):
        self.run_id = run_id
        self.stages = _initial_stages()
        self._index = {s["key"]: s for s in self.stages}

    def _progress_for(self, key: str) -> int:
        return dict((k, p) for k, _, p in STAGES)[key]

    def begin(self, key: str, message: str) -> None:
        self._index[key]["status"] = "running"
        logger.info(message, extra={"run_id": self.run_id, "stage": key})
        _set_status(
            status="running", stage=key, message=message,
            progress=self._progress_for(key), stages=list(self.stages),
        )

    def finish(self, key: str, detail: str | None = None) -> None:
        self._index[key]["status"] = "done"
        self._index[key]["detail"] = detail
        if detail:
            logger.info(detail, extra={"run_id": self.run_id, "stage": key})
        _set_status(stages=list(self.stages))

    def fail(self, key: str | None, exc: Exception) -> None:
        if key and key in self._index:
            self._index[key]["status"] = "error"
            self._index[key]["detail"] = f"{type(exc).__name__}: {exc}"
        for stage in self.stages:
            if stage["status"] == "pending":
                stage["status"] = "skipped"
        logger.exception(
            "Pipeline failed during '%s'", key or "startup",
            extra={"run_id": self.run_id, "stage": key},
        )

# Only the formats app/ingestion/parser.py can actually read.
ALLOWED_UPLOAD_SUFFIXES = {".csv", ".json", ".xml"}

# Uploads are streamed to disk, so this bounds disk rather than memory. The
# ceiling matters most on a small hosted instance, where the pipeline that
# follows needs far more headroom than the file itself.
MAX_UPLOAD_BYTES = 256 * 1024 * 1024


def _safe_upload_path(upload_dir: Path, filename: str | None) -> Path:
    """
    Resolve a client-supplied filename to a path inside `upload_dir`.

    The name arrives from the browser and is not trustworthy: an absolute
    path ("/etc/cron.d/evil") replaces the directory outright, and "../"
    segments walk out of it, so a plain `upload_dir / filename` is an
    arbitrary file write. Take the basename, check the extension, then
    confirm the resolved path really is inside the directory before it is
    opened for writing.
    """
    name = Path(filename or "").name.strip()
    if not name or name.startswith("."):
        raise HTTPException(status_code=400, detail="A file name is required.")

    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{suffix or name}'. "
                   f"Expected one of: {', '.join(sorted(ALLOWED_UPLOAD_SUFFIXES))}.",
        )

    target = (upload_dir / name).resolve()
    if not target.is_relative_to(upload_dir.resolve()):
        raise HTTPException(status_code=400, detail="Invalid file name.")
    return target


def _resolve_data_file(file_path: str) -> Path:
    """
    Confirm a caller-supplied pipeline input is one of ours.

    /run takes a path as a query parameter, so without this any file the
    backend process can read could be handed to the parser, and its contents
    surfaced through parse errors and the ingested rows.
    """
    data_dir = settings.DATA_DIR.resolve()
    candidate = Path(file_path).expanduser().resolve()
    if not candidate.is_relative_to(data_dir):
        raise HTTPException(
            status_code=400,
            detail="file_path must name a file inside the backend's data directory.",
        )
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"No such file: {file_path}")
    return candidate


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a data file (CSV/JSON/XML) for ingestion."""
    upload_dir = settings.DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = _safe_upload_path(upload_dir, file.filename)

    # Streamed in chunks rather than read() into memory: a transaction dump
    # is routinely hundreds of megabytes, and buffering one whole would take
    # the container down on a 512 MB instance before parsing even began.
    written = 0
    try:
        with open(file_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
                    )
                f.write(chunk)
    except Exception:
        # Do not leave a partial file behind for /run to pick up as input.
        file_path.unlink(missing_ok=True)
        raise

    return {
        "filename": file_path.name,
        "size_bytes": written,
        "path": str(file_path),
        "message": "File uploaded successfully. Call /api/ingest/run to process.",
    }


@router.post("/run")
async def run_pipeline(
    background_tasks: BackgroundTasks,
    file_path: str = None,
    clear_existing: bool = True,
):
    """Trigger the full analysis pipeline."""
    current = _get_status()
    if current["status"] == "running":
        return {"error": "Pipeline already running", "status": current}

    run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
    _set_status(
        status="running", progress=0, message="Starting pipeline...",
        run_id=run_id, stage=None, stages=_initial_stages(),
        error=None, error_type=None, traceback=None,
        started_at=_now(), finished_at=None,
    )

    # Determine file to process
    if not file_path:
        # Look for files in uploads or sample directory
        upload_dir = settings.DATA_DIR / "uploads"
        sample_dir = settings.DATA_DIR / "sample"

        for directory in [upload_dir, sample_dir]:
            if directory.exists():
                files = list(directory.glob("*.csv")) + list(directory.glob("*.json")) + list(directory.glob("*.xml"))
                if files:
                    file_path = str(files[0])
                    break

    if not file_path:
        message = ("No data file found. Upload a file, generate a sample, or "
                   "fetch live blockchain data first.")
        logger.error(message, extra={"run_id": run_id})
        _set_status(status="error", progress=0, message=message, run_id=run_id,
                    error=message, error_type="NoDataFile", finished_at=_now())
        return {"error": message, "run_id": run_id}

    try:
        resolved = _resolve_data_file(file_path)
    except HTTPException as exc:
        message = f"Cannot read {file_path}: {exc.detail}"
        logger.error(message, extra={"run_id": run_id})
        _set_status(status="error", progress=0, message=message, run_id=run_id,
                    error=message, error_type="UnreadableFile", finished_at=_now())
        raise

    file_path = str(resolved)
    background_tasks.add_task(_execute_pipeline, file_path, run_id, clear_existing)

    return {
        "run_id": run_id,
        "status": "running",
        "message": f"Pipeline started. Processing {file_path}",
    }


@router.get("/status")
def get_pipeline_status():
    """
    Current pipeline execution status, including the per-stage breakdown and,
    on failure, the exception type and its traceback.
    """
    return _get_status()


@router.get("/logs")
def get_pipeline_logs(run_id: str | None = None, limit: int = Query(300, ge=1, le=1000)):
    """
    The log for a pipeline run — the thing that was missing when a run died
    with nothing but "Pipeline error: [Errno 32] Broken pipe" on screen.

    With no `run_id`, returns the tail of the whole server log; with one,
    only the records that run emitted.
    """
    status = _get_status()
    return {
        "run_id": run_id or status.get("run_id"),
        "status": status.get("status"),
        "records": log_tail(limit=limit, run_id=run_id),
        "log_file": log_file_path(),
    }


@router.post("/generate-sample")
async def generate_sample_data(
    count: int = Query(5000, ge=1, le=200_000,
                       description="Number of synthetic transactions to generate."),
):
    """Generate synthetic sample data."""
    import sys
    if str(settings.BASE_DIR) not in sys.path:
        sys.path.insert(0, str(settings.BASE_DIR))

    from scripts.generate_synthetic import generate_dataset, save_csv, save_json, DARKNET_WALLETS

    records = generate_dataset(total=count)
    output_dir = settings.DATA_DIR / "sample"
    output_dir.mkdir(parents=True, exist_ok=True)

    save_csv(records, output_dir / "transactions.csv")
    save_json(records, output_dir / "transactions.json")

    # Auto-register the synthetic dataset's darknet-adjacent wallets as seed
    # wallets so risk propagation has something to propagate from out of the
    # box on the demo path. This is specific to the synthetic generator —
    # real-data ingestion (fetch-real) never auto-seeds anything, since
    # ChainTrace has no legitimate way to know which real wallets are
    # illicit; an operator maintains that watchlist themselves via
    # /api/settings/seed-wallets.
    with get_db() as con:
        con.executemany("""
            INSERT OR IGNORE INTO seed_wallets (address, label, source, added_at)
            VALUES (?, 'Synthetic demo: darknet-adjacent', 'generate-sample', CURRENT_TIMESTAMP)
        """, [(w,) for w in DARKNET_WALLETS])

    return {
        "count": len(records),
        "csv_path": str(output_dir / "transactions.csv"),
        "json_path": str(output_dir / "transactions.json"),
        "seed_wallets_registered": len(DARKNET_WALLETS),
        "message": f"Generated {len(records)} synthetic transactions",
    }


@router.post("/fetch-real")
async def fetch_real_data(
    max_transactions: int = Query(500, ge=1, le=20_000),
    max_blocks: int = Query(10, ge=1, le=200),
):
    """
    Pull genuine, verifiable on-chain Bitcoin transactions from Blockstream's
    public Esplora API (recent confirmed blocks) and save them in
    ChainTrace's ingestion format — real txids, real wallet addresses, real
    amounts. Every txid returned can be looked up on any block explorer.

    Requires outbound internet access to blockstream.info. There is no
    real-data source for the network-layer (IP/port) fields — they are
    intentionally left blank; see app/ingestion/real_fetcher.py.
    """
    try:
        records = list(fetch_recent_real_transactions(
            max_transactions=max_transactions, max_blocks=max_blocks,
        ))
    except EsploraError as e:
        return {"error": f"Could not reach Blockstream's API: {e}"}

    if not records:
        return {"error": "No usable transactions found in the scanned blocks. Try increasing max_blocks."}

    import sys
    if str(settings.BASE_DIR) not in sys.path:
        sys.path.insert(0, str(settings.BASE_DIR))
    from scripts.generate_synthetic import save_csv, save_json

    output_dir = settings.DATA_DIR / "real"
    save_csv(records, output_dir / "transactions.csv")
    save_json(records, output_dir / "transactions.json")

    return {
        "count": len(records),
        "csv_path": str(output_dir / "transactions.csv"),
        "json_path": str(output_dir / "transactions.json"),
        "message": f"Fetched {len(records)} real, verifiable Bitcoin transactions from the live blockchain.",
        "source": "Blockstream Esplora API (blockstream.info)",
    }


def _execute_pipeline(file_path: str, run_id: str, clear_existing: bool):
    """
    Execute the full pipeline in a background task.

    Every stage is announced before it runs and confirmed after, so the status
    the UI polls names the stage in flight rather than a bare percentage, and
    a failure is attributed to the stage that actually failed.
    """
    run = _Run(run_id)
    stage = None
    logger.info("Pipeline %s starting on %s (clear_existing=%s)",
                run_id, file_path, clear_existing, extra={"run_id": run_id})

    try:
        with get_db() as con:
            con.execute("""
                INSERT INTO pipeline_runs (run_id, started_at, status)
                VALUES (?, CURRENT_TIMESTAMP, 'running')
            """, [run_id])

        # Step 1: Clear existing data if requested
        stage = "clear"
        if clear_existing:
            run.begin(stage, "Clearing existing data...")
            with get_db() as con:
                clear_all_data(con)
            run.finish(stage, "Previous dataset and analysis state cleared")
        else:
            run.begin(stage, "Keeping existing data")
            run.finish(stage, "Existing rows retained; new records merged in")

        # Step 2: Parse file
        stage = "parse"
        run.begin(stage, f"Parsing {Path(file_path).name}...")
        raw_records = list(parse_file(file_path))
        if not raw_records:
            raise ValueError(
                f"{Path(file_path).name} contained no readable records. Check that "
                f"it is a CSV, JSON or XML export in ChainTrace's transaction format."
            )
        run.finish(stage, f"{len(raw_records)} records read")

        # Step 3: Validate
        stage = "validate"
        run.begin(stage, f"Validating {len(raw_records)} records...")
        valid_records, errors = validate_records(iter(raw_records))
        if not valid_records:
            sample = "; ".join(str(e) for e in errors[:3])
            raise ValueError(
                f"All {len(raw_records)} records failed validation."
                + (f" First errors: {sample}" if sample else "")
            )
        if errors:
            logger.warning("%s record(s) rejected during validation; first: %s",
                           len(errors), errors[0], extra={"run_id": run_id, "stage": stage})
        run.finish(stage, f"{len(valid_records)} valid, {len(errors)} rejected")

        # Step 4: Enrich with GeoIP
        stage = "enrich"
        run.begin(stage, "Enriching with GeoIP data...")
        enricher = get_enricher()
        valid_records = enricher.enrich_batch(valid_records)
        run.finish(stage, f"{len(valid_records)} records enriched")

        # Step 5: Load into DuckDB
        stage = "load"
        run.begin(stage, "Loading into database...")
        with get_db() as con:
            inserted = load_transactions(valid_records, con)
        run.finish(stage, f"{inserted} transactions written")

        # Step 6: Run ML pipeline
        stage = "analyse"
        run.begin(stage, "Running ML analysis (graph, clustering, scoring, alerts)...")
        summary = run_full_pipeline()
        alerts_generated = summary["steps"].get("alerts", {}).get("generated", 0)
        run.finish(stage, f"{alerts_generated} alerts generated")

        # Update pipeline run record
        with get_db() as con:
            con.execute("""
                UPDATE pipeline_runs
                SET finished_at = CURRENT_TIMESTAMP, status = 'completed',
                    records_total = ?, records_valid = ?, records_error = ?
                WHERE run_id = ?
            """, [len(raw_records), len(valid_records), len(errors), run_id])

        message = f"Pipeline complete. {inserted} records processed, {alerts_generated} alerts generated."
        logger.info(message, extra={"run_id": run_id})
        _set_status(
            status="completed", progress=100, message=message, run_id=run_id,
            stage=None, stages=run.stages, summary=summary,
            error=None, error_type=None, traceback=None, finished_at=_now(),
        )

    except Exception as e:
        run.fail(stage, e)
        detail = traceback.format_exc()
        _set_status(
            status="error",
            # Held at the failing stage's progress rather than reset to 0, so
            # the tracker shows how far the run actually got.
            progress=run._progress_for(stage) if stage else 0,
            message=f"{type(e).__name__} during '{stage or 'startup'}': {e}",
            run_id=run_id, stage=stage, stages=run.stages,
            error=str(e), error_type=type(e).__name__, traceback=detail,
            finished_at=_now(),
        )
        # The database has been cleared but not repopulated, so anything the
        # process still holds in memory describes a dataset that is no longer
        # there. Dropping it is what stops the app rendering a graph and
        # dashboard for data the tables no longer contain.
        if clear_existing:
            try:
                from app.ml.trainer import reset_analysis_state
                reset_analysis_state()
            except Exception:
                logger.exception("Could not reset analysis state after a failed run",
                                 extra={"run_id": run_id})
        try:
            with get_db() as con:
                con.execute("""
                    UPDATE pipeline_runs SET finished_at = CURRENT_TIMESTAMP,
                    status = 'error', log = ? WHERE run_id = ?
                """, [detail[-4000:], run_id])
        except Exception:
            logger.exception("Could not record the failed run in pipeline_runs",
                             extra={"run_id": run_id})
