import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from app.config import settings

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
logger = logging.getLogger("tejas.database")

connect_args = {"check_same_thread": False} if is_sqlite else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _json_default_sql() -> str:
    if engine.dialect.name == "postgresql":
        return "JSON DEFAULT '{}'::json"
    return "JSON DEFAULT '{}'"


def _datetime_sql() -> str:
    if engine.dialect.name == "postgresql":
        return "TIMESTAMP"
    return "DATETIME"


def _table_columns(conn, table_name: str) -> set[str]:
    try:
        if engine.dialect.name == "postgresql":
            rows = conn.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = :table_name
                    """
                ),
                {"table_name": table_name},
            ).fetchall()
            return {row[0] for row in rows}

        if engine.dialect.name == "sqlite":
            rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            return {row[1] for row in rows}

        rows = conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = :table_name
                """
            ),
            {"table_name": table_name},
        ).fetchall()
        return {row[0] for row in rows}
    except Exception as e:
        logger.warning("Could not inspect table %s during migration: %s", table_name, e)
        return set()


def _add_column(conn, table_name: str, column_name: str, ddl: str):
    cols = _table_columns(conn, table_name)
    if cols and column_name not in cols:
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))
        logger.info("Migrated %s.%s", table_name, column_name)


def _rename_column(conn, table_name: str, old_name: str, new_name: str):
    cols = _table_columns(conn, table_name)
    if cols and old_name in cols and new_name not in cols:
        conn.execute(text(f"ALTER TABLE {table_name} RENAME COLUMN {old_name} TO {new_name}"))
        logger.info("Migrated %s.%s -> %s", table_name, old_name, new_name)


def run_database_migrations():
    """Applies non-destructive schema migrations for existing databases."""
    try:
        with engine.begin() as conn:
            _add_column(conn, "incidents", "resolution_notes", "TEXT")
            _add_column(conn, "incidents", "anpr_data", _json_default_sql())
            _add_column(conn, "incidents", "affected_track_id", "VARCHAR(50)")
            _add_column(conn, "incidents", "updated_at", _datetime_sql())

            _add_column(conn, "audit_logs", "details", _json_default_sql())
            _add_column(conn, "audit_logs", "created_at", _datetime_sql())

            _add_column(conn, "events", "incident_id", "VARCHAR(100)")
            _add_column(conn, "alerts", "alert_level", "VARCHAR(20) DEFAULT 'INFO'")

            _rename_column(conn, "zones", "fence_height", "fence_depth")
            _add_column(conn, "zones", "fence_type", "VARCHAR(10) DEFAULT '2D'")
            _add_column(conn, "zones", "fence_depth", "FLOAT DEFAULT 0.0")
    except Exception as e:
        logger.exception("Database migration failed: %s", e)
        raise


# Backward-compatible name for older imports/scripts.
def run_sqlite_migrations():
    run_database_migrations()
