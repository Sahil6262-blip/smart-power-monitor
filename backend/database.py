from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.types import TypeDecorator

from config import get_config


class UTCDateTime(TypeDecorator):
    """SQLite drops tzinfo; normalize every bind/result to aware UTC."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive timestamps are not allowed")
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


class Base(DeclarativeBase):
    pass


url = get_config().database_url
if url.startswith("sqlite:///") and ":memory:" not in url:
    Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(
    url,
    pool_pre_ping=True,
    **(
        {"connect_args": {"check_same_thread": False, "timeout": 15}}
        if url.startswith("sqlite")
        else {"pool_recycle": 300}
    ),
)
if url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def sqlite_pragmas(connection, _):
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session


def utcnow():
    return datetime.now(timezone.utc)
