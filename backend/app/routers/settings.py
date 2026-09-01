"""
ChainTrace Forensics — Settings Router
"""

from fastapi import APIRouter
from app.database import get_db, get_db_readonly
from app.config import settings

router = APIRouter(prefix="/api/settings", tags=["Settings"])

DEFAULT_SETTINGS = {
    "mixer_confidence_threshold": str(settings.MIXER_CONFIDENCE_THRESHOLD),
    "darknet_proximity_hops": str(settings.DARKNET_PROXIMITY_HOPS),
    "velocity_spike_threshold": str(settings.VELOCITY_SPIKE_THRESHOLD),
    "round_amount_threshold": str(settings.ROUND_AMOUNT_THRESHOLD),
    "anomaly_percentile": str(settings.ANOMALY_PERCENTILE),
    "geo_ip_strict": "false",
}


@router.get("")
def get_settings():
    """Get all application settings."""
    with get_db_readonly() as con:
        rows = con.execute("SELECT key, value FROM app_settings").fetchall()

    result = dict(DEFAULT_SETTINGS)
    for key, value in rows:
        result[key] = value

    return result


@router.put("")
def update_settings(updates: dict):
    """Update application settings."""
    with get_db() as con:
        for key, value in updates.items():
            con.execute("""
                INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
            """, [key, str(value)])

    return {"message": "Settings updated", "settings": updates}


@router.post("/reset")
def reset_settings():
    """Reset all settings to defaults."""
    with get_db() as con:
        con.execute("DELETE FROM app_settings")

    return {"message": "Settings reset to defaults", "settings": DEFAULT_SETTINGS}


@router.post("/purge-cache")
def purge_cache():
    """Purge all cached graph nodes and temporary analysis files."""
    import shutil
    from app.ml.trainer import get_entity_graph

    # Clear model files
    models_dir = settings.MODELS_DIR
    if models_dir.exists():
        shutil.rmtree(models_dir)
        models_dir.mkdir(parents=True, exist_ok=True)

    return {"message": "Cache purged successfully"}
