import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'ai_reading.db'}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine_kwargs = {"connect_args": connect_args}
if DATABASE_URL == "sqlite:///:memory:":
    engine_kwargs["poolclass"] = StaticPool
engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    migrate_sqlite_columns()


def migrate_sqlite_columns() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(segments)")).fetchall()}
        if "label" not in columns:
            connection.execute(text("ALTER TABLE segments ADD COLUMN label VARCHAR(120) DEFAULT ''"))
        if "is_spoken" not in columns:
            connection.execute(text("ALTER TABLE segments ADD COLUMN is_spoken INTEGER DEFAULT 1"))
        character_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(characters)")).fetchall()}
        if "position" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN position INTEGER DEFAULT 0 NOT NULL"))
            connection.execute(
                text(
                    """
                    UPDATE characters
                    SET position = (
                        SELECT COUNT(*)
                        FROM characters c2
                        WHERE c2.book_id = characters.book_id AND c2.id <= characters.id
                    ) - 1
                    """
                )
            )
