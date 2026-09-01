"""
ChainTrace Forensics — Settings Router
"""

from fastapi import APIRouter
from app.database import get_db, get_db_readonly
from app.runtime_settings import default_settings_dict

router = APIRouter(prefix="/api/settings", tags=["Settings"])

DEFAULT_SETTINGS = {**default_settings_dict(), "geo_ip_strict": "false"}


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
    from app.config import settings

    # Clear model files
    models_dir = settings.MODELS_DIR
    if models_dir.exists():
        shutil.rmtree(models_dir)
        models_dir.mkdir(parents=True, exist_ok=True)

    return {"message": "Cache purged successfully"}


# ── Seed / Watchlist Wallets ────────────────────────────────────────
# The known-illicit addresses risk propagation (Section 4: "Risk Scoring")
# spreads proximity from. An investigator maintains this list themselves —
# it is never fabricated by ChainTrace.

@router.get("/seed-wallets")
def list_seed_wallets():
    with get_db_readonly() as con:
        rows = con.execute("""
            SELECT address, label, source, added_at FROM seed_wallets
            ORDER BY added_at DESC
        """).fetchall()
    return [
        {"address": r[0], "label": r[1], "source": r[2], "added_at": str(r[3])}
        for r in rows
    ]


@router.post("/seed-wallets")
def add_seed_wallet(address: str, label: str = "", source: str = "manual"):
    address = address.strip()
    if not address:
        return {"error": "address is required"}
    with get_db() as con:
        con.execute("""
            INSERT OR REPLACE INTO seed_wallets (address, label, source, added_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """, [address, label or None, source])
    return {"message": f"Seed wallet {address} added", "address": address}


@router.delete("/seed-wallets/{address}")
def remove_seed_wallet(address: str):
    with get_db() as con:
        con.execute("DELETE FROM seed_wallets WHERE address = ?", [address])
    return {"message": f"Seed wallet {address} removed"}
