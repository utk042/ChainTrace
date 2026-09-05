"""
ChainTrace Forensics — FastAPI Application Entry Point
"""

import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.database import init_database, close_database, get_db
from app.logging_config import (
    configure_logging, get_logger, log_file_path, std_streams_broken,
)
from app.routers import dashboard, alerts, graph_explorer, wallets, transactions, ingest, settings as settings_router

configure_logging()
logger = get_logger("app.main")

# Bumped whenever the shape of a response the frontend depends on changes.
#
# A running backend keeps its code in memory: a dev server started before a
# `git pull`, or one orphaned when its terminal closed, keeps answering with
# the old code while the browser hot-reloads the new frontend against it. The
# result is a UI rendering a half-populated response and an operator debugging
# a bug that was already fixed on disk. The frontend compares this against the
# revision it was built for and says so outright.
API_REVISION = 2

PROCESS_ID = os.getpid()
STARTED_AT = datetime.now(timezone.utc).isoformat(timespec="seconds")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: initialize DB on startup."""
    logger.info("ChainTrace Forensics — starting (pid %s, api revision %s)",
                PROCESS_ID, API_REVISION)
    logger.info("Logging to %s", log_file_path())
    init_database()
    logger.info("Database initialized at %s", settings.DUCKDB_PATH)

    from app.ml.autoencoder import backend_name, backend_reason
    logger.info("ML backend: %s (%s)", backend_name(), backend_reason())

    # Try loading existing models
    try:
        from app.graph.builder import build_entity_graph

        with get_db() as con:
            tx_count = con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]

        if tx_count > 0:
            logger.info("Found %s existing transactions. Building graph...", tx_count)
            from app.ml import trainer
            trainer._entity_graph = build_entity_graph()
            from app.graph.clustering import cluster_wallets
            trainer._clusters = cluster_wallets(trainer._entity_graph)
            # Without this the rebuilt graph carries no anomaly scores or
            # risk tiers, only topology.
            from app.graph.builder import apply_scores_from_db
            scored = apply_scores_from_db(trainer._entity_graph)
            logger.info("Restored scores for %s wallet(s)", scored)

            # Try loading pre-trained models
            from app.ml.autoencoder import AnomalyDetector
            from app.ml.embeddings import GraphEmbedder
            detector = AnomalyDetector()
            if detector.load():
                trainer._anomaly_detector = detector
            embedder = GraphEmbedder()
            if embedder.load():
                trainer._graph_embedder = embedder

            logger.info("Existing data loaded")
        else:
            logger.info("No existing data. Upload a dataset via /api/ingest/upload")
    except Exception:
        # Logged with the traceback rather than as a one-line str(e): a
        # failure here leaves the app serving an empty graph over a full
        # database, and "Could not load existing data: 0" was never enough
        # to work out why.
        logger.exception("Could not load existing data")

    logger.info("ChainTrace Forensics ready")
    yield
    logger.info("ChainTrace Forensics — shutting down")
    close_database()


app = FastAPI(
    title="ChainTrace Forensics",
    description="AI-Powered Bitcoin Transaction Monitoring & Analysis System",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS.
#
# A wildcard origin and credentialed requests are mutually exclusive: every
# browser rejects `Access-Control-Allow-Origin: *` on a credentialed request,
# so advertising both means the permissive deployment silently fails the
# stricter clients. ChainTrace's frontend sends no cookies or auth headers,
# so credentials are only enabled when the origins are actually enumerated.
_wildcard_origins = "*" in settings.CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=None if _wildcard_origins else r"https://.*\.vercel\.app",
    allow_credentials=not _wildcard_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    # The offline cache reads these to tell stored data from live data.
    expose_headers=["x-chaintrace-cache", "x-chaintrace-cached-at"],
    max_age=600,
)

# Graph payloads are large and highly repetitive JSON; on a free-tier host the
# transfer dominates the response time.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Return JSON for an unhandled error rather than an HTML traceback page.

    The frontend distinguishes an unreachable backend from a failing one by
    the shape of the response; an HTML 500 body reads as neither. The detail
    is logged server-side and deliberately not returned.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_error",
            "detail": "The backend failed to handle this request. See the server logs.",
            "path": request.url.path,
        },
    )

# Register routers
app.include_router(dashboard.router)
app.include_router(alerts.router)
app.include_router(graph_explorer.router)
app.include_router(wallets.router)
app.include_router(transactions.router)
app.include_router(ingest.router)
app.include_router(settings_router.router)


API_INFO = {
    "name": "ChainTrace Forensics",
    "version": "1.0.0",
    "description": "AI-Powered Bitcoin Transaction Monitoring & Analysis",
    "docs": "/docs",
}


@app.get("/api")
def api_root():
    return API_INFO


@app.get("/api/health")
def health():
    """
    Liveness, plus the state the UI needs to tell four situations apart:
    unreachable, reachable-but-broken, reachable-but-empty, and ready.

    The previous version swallowed every database exception and returned
    `has_data: false`, so a backend that could not open DuckDB at all — a
    stale `uvicorn --reload` worker still holding the file lock is the usual
    cause — was indistinguishable from one with nothing ingested. The app
    then showed "no data ingested, go and ingest some" over a database that
    was full, and every page that got its read in anyway rendered results
    that contradicted the banner. Whatever goes wrong here is now named.
    """
    from app.ml.autoencoder import backend_name, backend_reason, is_light_mode
    from app.ml.trainer import get_entity_graph

    counts = {"transactions": 0, "wallets": 0, "alerts": 0}
    db_error = None
    try:
        with get_db() as con:
            counts["transactions"] = con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            counts["wallets"] = con.execute("SELECT COUNT(*) FROM wallet_features").fetchone()[0]
            counts["alerts"] = con.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
    except Exception as exc:
        db_error = str(exc)
        logger.exception("Health check could not read the database")

    graph = get_entity_graph()

    return {
        # 'degraded' is still a live backend, so the frontend keeps talking
        # to it — but it must not present the database as merely empty.
        "status": "healthy" if db_error is None else "degraded",
        "service": "ChainTrace Forensics",
        "version": "1.0.0",
        # Identity of the process answering, so a stale server can be spotted
        # and killed rather than debugged.
        "api_revision": API_REVISION,
        "pid": PROCESS_ID,
        "started_at": STARTED_AT,
        # True once a console write has been dropped because nothing is
        # reading stdout — the backend was launched from a terminal or wrapper
        # that has since gone. Harmless now, but it means the server's console
        # output is going nowhere and `data/logs/` is the only copy.
        "console_detached": std_streams_broken(),
        "has_data": db_error is None and counts["transactions"] > 0,
        "db_error": db_error,
        "transaction_count": counts["transactions"],
        "wallet_count": counts["wallets"],
        "alert_count": counts["alerts"],
        # In-memory analysis state. When this disagrees with the table counts
        # the graph on screen is not backed by the current database, which is
        # what made clicking a node return nothing at all.
        "graph_nodes": graph.number_of_nodes() if graph is not None else 0,
        "light_mode": is_light_mode(),
        "ml_backend": backend_name(),
        "ml_backend_reason": backend_reason(),
        "log_file": log_file_path(),
    }


@app.get("/api/logs")
def recent_logs(limit: int = 200, run_id: str | None = None):
    """
    The tail of the server log.

    Running ChainTrace locally usually means the backend's output is in a
    terminal somewhere behind the browser, or — as happened here — in a
    terminal that no longer exists. The operator needs to be able to read
    what the backend actually did without going to find it.
    """
    from app.logging_config import log_tail
    limit = max(1, min(limit, 1000))
    return {
        "records": log_tail(limit=limit, run_id=run_id),
        "log_file": log_file_path(),
    }


# ─── The built frontend, served from this process ────────────────────
#
# Registered last, after every router, so it can only ever see a path
# nothing else claimed.
#
# This is what makes an air-gapped install one process: no nginx, no second
# port, no CORS, no VITE_API_URL. The frontend calls the origin it was
# served from, which is this one. With no build present the backend behaves
# exactly as before and serves the API alone.

_FRONTEND_DIST = Path(settings.FRONTEND_DIST)
_FRONTEND_INDEX = _FRONTEND_DIST / "index.html"

# Hashed build output: the bytes behind one of these URLs never change.
_IMMUTABLE_PREFIXES = ("assets/", "fonts/", "icons/")

# The worker must be revalidated on every load. Cached for even a few hours
# it keeps serving the previous build's precache, and no deployment reaches
# anyone until it expires. Same for the shell, which names asset hashes that
# stop existing.
_NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}


def _serve_index() -> FileResponse:
    return FileResponse(_FRONTEND_INDEX, media_type="text/html", headers=_NO_CACHE)


if _FRONTEND_INDEX.is_file():
    logger.info("Serving the frontend from %s", _FRONTEND_DIST)

    @app.get("/{asset_path:path}", include_in_schema=False)
    def frontend(asset_path: str):
        """
        A file from the build, or the SPA shell for a client-side route.

        `/api/...` is answered with JSON 404 rather than the shell. An SPA
        rewrite that returns index.html for an unmatched API path is exactly
        what the frontend's health check exists to catch: a 200 with an HTML
        body reads as a healthy backend right up until the first response is
        parsed.
        """
        if asset_path == "api" or asset_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"error": "not_found", "detail": f"No API route for /{asset_path}."},
            )

        # Resolve inside the build directory and nowhere else: `..` segments
        # in a request path must not reach the filesystem above it.
        candidate = (_FRONTEND_DIST / asset_path).resolve()
        root = _FRONTEND_DIST.resolve()
        if asset_path and candidate.is_file() and candidate.is_relative_to(root):
            if asset_path.startswith(_IMMUTABLE_PREFIXES):
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            elif asset_path == "sw.js":
                headers = {**_NO_CACHE, "Service-Worker-Allowed": "/"}
            else:
                headers = _NO_CACHE
            return FileResponse(candidate, headers=headers)

        # Anything else is a client-side route.
        return _serve_index()

else:
    # No build to serve, so `/` keeps answering with the API's own
    # description as it always has. Dropping it would 404 the address people
    # actually type at an API-only deployment.
    @app.get("/")
    def root():
        return API_INFO
