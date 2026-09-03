"""
ChainTrace Forensics — FastAPI Application Entry Point
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.database import init_database, get_db_readonly
from app.routers import dashboard, alerts, graph_explorer, wallets, transactions, ingest, settings as settings_router


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
            # The rebuilt graph knows nothing about the last run's scores until
            # these are copied back on; without it a restarted backend serves a
            # graph with every risk colour and anomaly score missing.
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

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    Liveness plus enough state for the UI to explain itself.

    The frontend uses `has_data` to tell "the backend is down" apart from
    "the backend is up but nothing has been ingested yet" — two situations
    that previously both rendered as an empty screen with no explanation,
    which is exactly what a fresh cloud deployment looks like on first load.
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
