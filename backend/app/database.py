"""
ChainTrace Forensics — DuckDB Connection Manager

One DuckDB *instance* per process, handed out as cursors.

DuckDB refuses to open a second connection to the same file with a different
configuration than the connections already open:

    Connection Error: Can't open a connection to same database file with a
    different configuration than existing connections

Read/write and `read_only=True` are different configurations, so the previous
arrangement — analytical endpoints on `read_only` connections, ingestion on
read/write ones — could not survive its own concurrency. Whenever an ingest
run held the writer, every dashboard, wallet, transaction and graph read in
flight raised; whenever a poll held a reader, the pipeline raised. The
failures were timing-dependent and silent: `/api/health` caught the exception
and reported `has_data: false`, which is why a database holding a full
analysis could render the app's "no data ingested" banner across every page
while the tables underneath were populated.

There is nothing to gain from the split. DuckDB is embedded, so both kinds of
connection live in this process anyway, and `read_only` protects against
nothing an in-process caller can do. So: a single lazily-opened connection,
`.cursor()` per caller (an independent connection over the same instance,
which is DuckDB's supported way to work from several threads), and one
configuration that every caller shares.
"""

import threading

import duckdb
from contextlib import contextmanager
from pathlib import Path
from app.config import settings
from app.logging_config import get_logger

logger = get_logger("app.database")

_DB_PATH = settings.DUCKDB_PATH

_root_con: duckdb.DuckDBPyConnection | None = None
_root_lock = threading.Lock()


class DatabaseUnavailable(RuntimeError):
    """
    The DuckDB file could not be opened at all.

    Distinct from "opened fine and is empty": an empty database is a normal
    state the operator fixes by ingesting, whereas this is a broken one —
    most often a second ChainTrace process (a stale `uvicorn --reload`
    worker, a leftover container) still holding the file lock. Callers must
    not collapse the two, or the UI ends up telling the operator to ingest
    data they already have.
    """


def _connect() -> duckdb.DuckDBPyConnection:
    """Open the process-wide connection and make sure the schema is there."""
    Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(_DB_PATH)
    _init_schema(con)
    return con


def _root() -> duckdb.DuckDBPyConnection:
    """The process-wide connection, opened on first use."""
    global _root_con
    if _root_con is None:
        with _root_lock:
            if _root_con is None:
                try:
                    _root_con = _connect()
                except Exception as exc:
                    logger.error("Could not open DuckDB at %s: %s", _DB_PATH, exc)
                    raise DatabaseUnavailable(str(exc)) from exc
    return _root_con


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
    """Open the process connection and create the schema (called at startup)."""
    _root()


def close_database() -> None:
    """Release the process connection (called at shutdown)."""
    global _root_con
    with _root_lock:
        if _root_con is not None:
            try:
                _root_con.close()
            except Exception:  # pragma: no cover - shutdown best effort
                pass
            _root_con = None


@contextmanager
def get_db():
    """
    Yield a cursor on the process-wide connection.

    A cursor is its own connection over the shared instance, so two callers
    on different threads never trip over each other's transaction state, and
    no caller can pick a configuration that locks another one out.
    """
    cursor = _root().cursor()
    try:
        yield cursor
    finally:
        try:
            cursor.close()
        except Exception:  # pragma: no cover
            pass


# Reads and writes are the same connection now. The name is kept because it
# documents intent at every call site — this query only reads — and because
# renaming it across the routers would bury the actual fix in noise.
get_db_readonly = get_db


def database_error() -> str | None:
    """
    None when the database is usable, else why it is not.

    Callers use this to tell "reachable but empty" from "cannot be opened",
    which are the two states the UI previously rendered identically.
    """
    try:
        with get_db() as con:
            con.execute("SELECT 1").fetchone()
        return None
    except DatabaseUnavailable as exc:
        return str(exc)
    except Exception as exc:
        return str(exc)
