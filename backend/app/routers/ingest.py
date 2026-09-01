"""
ChainTrace Forensics — Ingest Router
File upload and pipeline execution endpoints.
"""

import uuid
import os
import shutil
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, BackgroundTasks
from app.config import settings
from app.database import get_db
from app.ingestion.parser import parse_file
from app.ingestion.validator import validate_records
from app.ingestion.enricher import get_enricher
from app.ingestion.loader import load_transactions, clear_all_data
from app.ml.trainer import run_full_pipeline

router = APIRouter(prefix="/api/ingest", tags=["Ingest"])

# Pipeline state
_pipeline_status = {
    "status": "idle",
    "progress": 0,
    "message": "",
    "run_id": None,
}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a data file (CSV/JSON/XML) for ingestion."""
    upload_dir = settings.DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file
    file_path = upload_dir / file.filename
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    return {
        "filename": file.filename,
        "size_bytes": len(content),
        "path": str(file_path),
        "message": f"File uploaded successfully. Call /api/ingest/run to process.",
    }


@router.post("/run")
async def run_pipeline(
    background_tasks: BackgroundTasks,
    file_path: str = None,
    clear_existing: bool = True,
):
    """Trigger the full analysis pipeline."""
    global _pipeline_status

    if _pipeline_status["status"] == "running":
        return {"error": "Pipeline already running", "status": _pipeline_status}

    run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
    _pipeline_status = {
        "status": "running",
        "progress": 0,
        "message": "Starting pipeline...",
        "run_id": run_id,
    }

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

    if not file_path or not Path(file_path).exists():
        _pipeline_status = {"status": "error", "progress": 0,
                            "message": "No data file found. Upload a file first.", "run_id": run_id}
        return {"error": "No data file found"}

    background_tasks.add_task(_execute_pipeline, file_path, run_id, clear_existing)

    return {
        "run_id": run_id,
        "status": "running",
        "message": f"Pipeline started. Processing {file_path}",
    }


@router.get("/status")
def get_pipeline_status():
    """Get current pipeline execution status."""
    return _pipeline_status


@router.post("/generate-sample")
async def generate_sample_data(count: int = 5000):
    """Generate synthetic sample data."""
    import sys
    if str(settings.BASE_DIR) not in sys.path:
        sys.path.insert(0, str(settings.BASE_DIR))

    from scripts.generate_synthetic import generate_dataset, save_csv, save_json

    records = generate_dataset(total=count)
    output_dir = settings.DATA_DIR / "sample"
    output_dir.mkdir(parents=True, exist_ok=True)

    save_csv(records, output_dir / "transactions.csv")
    save_json(records, output_dir / "transactions.json")

    return {
        "count": len(records),
        "csv_path": str(output_dir / "transactions.csv"),
        "json_path": str(output_dir / "transactions.json"),
        "message": f"Generated {len(records)} synthetic transactions",
    }


def _execute_pipeline(file_path: str, run_id: str, clear_existing: bool):
    """Execute the full pipeline in a background task."""
    global _pipeline_status

    try:
        # Record pipeline run
        with get_db() as con:
            con.execute("""
                INSERT INTO pipeline_runs (run_id, started_at, status)
                VALUES (?, CURRENT_TIMESTAMP, 'running')
            """, [run_id])

        # Step 1: Clear existing data if requested
        if clear_existing:
            _pipeline_status["message"] = "Clearing existing data..."
            _pipeline_status["progress"] = 5
            with get_db() as con:
                clear_all_data(con)

        # Step 2: Parse file
        _pipeline_status["message"] = "Parsing data file..."
        _pipeline_status["progress"] = 10
        raw_records = list(parse_file(file_path))

        # Step 3: Validate
        _pipeline_status["message"] = f"Validating {len(raw_records)} records..."
        _pipeline_status["progress"] = 20
        valid_records, errors = validate_records(iter(raw_records))

        # Step 4: Enrich with GeoIP
        _pipeline_status["message"] = "Enriching with GeoIP data..."
        _pipeline_status["progress"] = 30
        enricher = get_enricher()
        valid_records = enricher.enrich_batch(valid_records)

        # Step 5: Load into DuckDB
        _pipeline_status["message"] = "Loading into database..."
        _pipeline_status["progress"] = 40
        with get_db() as con:
            inserted = load_transactions(valid_records, con)

        # Step 6: Run ML pipeline
        _pipeline_status["message"] = "Running ML analysis..."
        _pipeline_status["progress"] = 50
        summary = run_full_pipeline()

        # Update pipeline run record
        with get_db() as con:
            con.execute("""
                UPDATE pipeline_runs
                SET finished_at = CURRENT_TIMESTAMP, status = 'completed',
                    records_total = ?, records_valid = ?, records_error = ?
                WHERE run_id = ?
            """, [len(raw_records), len(valid_records), len(errors), run_id])

        _pipeline_status = {
            "status": "completed",
            "progress": 100,
            "message": f"Pipeline complete. {inserted} records processed, {summary['steps'].get('alerts', {}).get('generated', 0)} alerts generated.",
            "run_id": run_id,
            "summary": summary,
        }

    except Exception as e:
        _pipeline_status = {
            "status": "error",
            "progress": 0,
            "message": f"Pipeline error: {str(e)}",
            "run_id": run_id,
        }
        # Update DB
        try:
            with get_db() as con:
                con.execute("""
                    UPDATE pipeline_runs SET finished_at = CURRENT_TIMESTAMP,
                    status = 'error', log = ? WHERE run_id = ?
                """, [str(e), run_id])
        except Exception:
            pass
