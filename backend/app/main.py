"""
ChainTrace Forensics — FastAPI Application Entry Point
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.database import init_database, get_db_readonly
from app.routers import dashboard, alerts, graph_explorer, wallets, transactions, ingest, settings as settings_router

logger = logging.getLogger("chaintrace")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: initialize DB on startup."""
    print("\n🔗 ChainTrace Forensics — Starting...")
    init_database()
    print("✓ Database initialized")

    from app.ml.autoencoder import backend_name, backend_reason
    print(f"  ML backend: {backend_name()} ({backend_reason()})")

    # Try loading existing models
    try:
        from app.ml.trainer import run_full_pipeline, get_entity_graph
        from app.graph.builder import build_entity_graph
        from app.database import get_db_readonly

        with get_db_readonly() as con:
            tx_count = con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]

        if tx_count > 0:
            print(f"  Found {tx_count} existing transactions. Building graph...")
            from app.ml import trainer
            trainer._entity_graph = build_entity_graph()
            from app.graph.clustering import cluster_wallets
            trainer._clusters = cluster_wallets(trainer._entity_graph)
            # Without this the rebuilt graph carries no anomaly scores or
            # risk tiers, only topology.
            from app.graph.builder import apply_scores_from_db
            scored = apply_scores_from_db(trainer._entity_graph)
            print(f"  Restored scores for {scored} wallet(s)")

            # Try loading pre-trained models
            from app.ml.autoencoder import AnomalyDetector
            from app.ml.embeddings import GraphEmbedder
            detector = AnomalyDetector()
            if detector.load():
                trainer._anomaly_detector = detector
            embedder = GraphEmbedder()
            if embedder.load():
                trainer._graph_embedder = embedder

            print("✓ Existing data loaded")
        else:
            print("ℹ No existing data. Upload a dataset via /api/ingest/upload")
    except Exception as e:
        print(f"⚠ Could not load existing data: {e}")

    print("✓ ChainTrace Forensics ready!\n")
    yield
    print("\n🔗 ChainTrace Forensics — Shutting down...")


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


@app.get("/")
def root():
    return {
        "name": "ChainTrace Forensics",
        "version": "1.0.0",
        "description": "AI-Powered Bitcoin Transaction Monitoring & Analysis",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    """
    Liveness, plus the state the UI needs to distinguish an unreachable
    backend from a reachable one with an empty database.
    """
    from app.ml.autoencoder import backend_name, backend_reason, is_light_mode

    tx_count = 0
    try:
        with get_db_readonly() as con:
            tx_count = con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    except Exception:
        pass

    return {
        "status": "healthy",
        "service": "ChainTrace Forensics",
        "version": "1.0.0",
        "has_data": tx_count > 0,
        "transaction_count": tx_count,
        "light_mode": is_light_mode(),
        "ml_backend": backend_name(),
        "ml_backend_reason": backend_reason(),
    }
