"""
ChainTrace Forensics — DuckDB Connection Manager
Thread-safe DuckDB connection pool for FastAPI dependency injection.
"""

import duckdb
from contextlib import contextmanager
from pathlib import Path
from app.config import settings


_DB_PATH = settings.DUCKDB_PATH


def _init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Create core tables if they don't exist."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            txid              VARCHAR PRIMARY KEY,
            timestamp         TIMESTAMP,
            src_ip            VARCHAR,
            dst_ip            VARCHAR,
            src_port          INTEGER,
            dst_port          INTEGER,
            input_addresses   VARCHAR[],
            output_addresses  VARCHAR[],
            input_amounts     DOUBLE[],
            output_amounts    DOUBLE[],
            fee               DOUBLE,
            script_type       VARCHAR,
            geo_country_src   VARCHAR,
            geo_country_dst   VARCHAR,
            asn_src           VARCHAR,
            asn_dst           VARCHAR
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS wallet_features (
            address           VARCHAR PRIMARY KEY,
            tx_count          INTEGER,
            total_received    DOUBLE,
            total_sent        DOUBLE,
            fan_in_degree     INTEGER,
            fan_out_degree    INTEGER,
            avg_tx_amount     DOUBLE,
            amount_variance   DOUBLE,
            velocity_1h       DOUBLE,
            velocity_24h      DOUBLE,
            round_amount_ratio DOUBLE,
            unique_ips        INTEGER,
            unique_countries  INTEGER,
            first_seen        TIMESTAMP,
            last_seen         TIMESTAMP,
            age_days          DOUBLE,
            cluster_id        INTEGER,
            anomaly_score     DOUBLE,
            risk_tier         VARCHAR,
            peel_chain_depth  INTEGER DEFAULT 0,
            peel_chain_role   VARCHAR,
            mixer_interaction_count INTEGER DEFAULT 0,
            darknet_proximity_hops  INTEGER,
            darknet_proximity_score DOUBLE DEFAULT 0.0
        );
    """)

    # Migration-safe: existing on-disk DBs from before these columns existed.
    for col, decl in [
        ("peel_chain_depth", "INTEGER DEFAULT 0"),
        ("peel_chain_role", "VARCHAR"),
        ("mixer_interaction_count", "INTEGER DEFAULT 0"),
        ("darknet_proximity_hops", "INTEGER"),
        ("darknet_proximity_score", "DOUBLE DEFAULT 0.0"),
    ]:
        con.execute(f"ALTER TABLE wallet_features ADD COLUMN IF NOT EXISTS {col} {decl};")

    con.execute("""
        CREATE TABLE IF NOT EXISTS seed_wallets (
            address    VARCHAR PRIMARY KEY,
            label      VARCHAR,
            source     VARCHAR,
            added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            alert_id      VARCHAR PRIMARY KEY,
            entity_id     VARCHAR,
            entity_type   VARCHAR,
            risk_tier     VARCHAR,
            confidence    DOUBLE,
            model         VARCHAR,
            description   TEXT,
            shap_values   JSON,
            timestamp     TIMESTAMP,
            status        VARCHAR DEFAULT 'pending'
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS ip_metadata (
            ip_address    VARCHAR PRIMARY KEY,
            country       VARCHAR,
            city          VARCHAR,
            asn           VARCHAR,
            org           VARCHAR,
            latitude      DOUBLE,
            longitude     DOUBLE,
            hit_count     INTEGER DEFAULT 0,
            first_seen    TIMESTAMP,
            last_seen     TIMESTAMP
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            run_id        VARCHAR PRIMARY KEY,
            started_at    TIMESTAMP,
            finished_at   TIMESTAMP,
            status        VARCHAR DEFAULT 'running',
            records_total INTEGER DEFAULT 0,
            records_valid INTEGER DEFAULT 0,
            records_error INTEGER DEFAULT 0,
            log           TEXT DEFAULT ''
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key   VARCHAR PRIMARY KEY,
            value VARCHAR
        );
    """)


def init_database() -> None:
    """Initialize database with schema (called at startup)."""
    con = duckdb.connect(_DB_PATH)
    try:
        _init_schema(con)
    finally:
        con.close()


@contextmanager
def get_db():
    """Yield a read/write DuckDB connection (use in FastAPI Depends)."""
    con = duckdb.connect(_DB_PATH)
    try:
        yield con
    finally:
        con.close()


@contextmanager
def get_db_readonly():
    """Yield a read-only DuckDB connection for analytical queries."""
    con = duckdb.connect(_DB_PATH, read_only=True)
    try:
        yield con
    finally:
        con.close()
