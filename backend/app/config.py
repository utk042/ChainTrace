"""
ChainTrace Forensics — Configuration
Central settings for all components (paths, thresholds, model params).
"""

import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application-wide settings loaded from environment or .env file."""

    # ── Paths ──────────────────────────────────────────────────────────
    BASE_DIR: Path = Path(__file__).resolve().parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    DUCKDB_PATH: str = str(BASE_DIR / "data" / "chaintrace.duckdb")
    MODELS_DIR: Path = BASE_DIR / "data" / "models"
    GEOIP_DB_PATH: str = str(BASE_DIR / "data" / "GeoLite2-City.mmdb")

    # ── API ────────────────────────────────────────────────────────────
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # ── ML / Autoencoder ───────────────────────────────────────────────
    AE_INPUT_DIM: int = 13
    AE_HIDDEN_DIMS: list[int] = [32, 16, 8]
    AE_LEARNING_RATE: float = 1e-3
    AE_EPOCHS: int = 100
    AE_BATCH_SIZE: int = 128
    ANOMALY_PERCENTILE: float = 95.0  # threshold for flagging

    # ── Node2Vec ───────────────────────────────────────────────────────
    N2V_EMBEDDING_DIM: int = 64
    N2V_WALK_LENGTH: int = 20
    N2V_CONTEXT_SIZE: int = 10
    N2V_WALKS_PER_NODE: int = 10
    N2V_EPOCHS: int = 50
    N2V_LEARNING_RATE: float = 0.01

    # ── Graph ──────────────────────────────────────────────────────────
    LOUVAIN_RESOLUTION: float = 1.0

    # ── Forensic Thresholds (user-configurable) ────────────────────────
    MIXER_CONFIDENCE_THRESHOLD: float = 0.85
    DARKNET_PROXIMITY_HOPS: int = 3
    VELOCITY_SPIKE_THRESHOLD: int = 50   # tx per hour
    ROUND_AMOUNT_THRESHOLD: float = 0.5  # ratio of round outputs

    # ── SHAP ───────────────────────────────────────────────────────────
    SHAP_BACKGROUND_SIZE: int = 100

    model_config = {"env_prefix": "CT_", "env_file": ".env"}


settings = Settings()

# Ensure directories exist
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.MODELS_DIR.mkdir(parents=True, exist_ok=True)
