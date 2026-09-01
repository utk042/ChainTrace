"""
ChainTrace Forensics — Effective Runtime Settings
`app.config.settings` holds static, env-based defaults. The Settings page
lets an operator override forensic thresholds at runtime, persisted in the
`app_settings` DuckDB table. This module merges the two so detection code
reads what the operator actually configured, not just the env defaults —
without this, editing a threshold in the UI and clicking "Deploy Config"
would change a value in the database that nothing ever reads back.
"""

from app.database import get_db_readonly
from app.config import settings as static_settings

# key -> (static default, caster)
_SCHEMA = {
    "mixer_confidence_threshold": (static_settings.MIXER_CONFIDENCE_THRESHOLD, float),
    "darknet_proximity_hops": (static_settings.DARKNET_PROXIMITY_HOPS, int),
    "velocity_spike_threshold": (static_settings.VELOCITY_SPIKE_THRESHOLD, float),
    "round_amount_threshold": (static_settings.ROUND_AMOUNT_THRESHOLD, float),
    "anomaly_percentile": (static_settings.ANOMALY_PERCENTILE, float),
}


def default_settings_dict() -> dict[str, str]:
    """String-valued defaults, in the shape the /api/settings GET/PUT endpoints use."""
    return {k: str(v) for k, (v, _) in _SCHEMA.items()}


def get_effective_settings() -> dict[str, float | int]:
    """Defaults overridden by whatever's stored in app_settings, correctly typed."""
    try:
        with get_db_readonly() as con:
            rows = con.execute("SELECT key, value FROM app_settings").fetchall()
        overrides = dict(rows)
    except Exception:
        overrides = {}

    result = {}
    for key, (default, cast) in _SCHEMA.items():
        raw = overrides.get(key)
        if raw is None:
            result[key] = default
            continue
        try:
            result[key] = cast(raw)
        except (TypeError, ValueError):
            result[key] = default
    return result
