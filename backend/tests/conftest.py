import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_test_directory = tempfile.TemporaryDirectory(prefix="wattwise-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + (Path(_test_directory.name) / "test.db").as_posix()
os.environ["DEMO_MODE"] = "true"
os.environ["SEED_DEMO_HISTORY"] = "false"

from fastapi.testclient import TestClient

from database import Base, engine
from main import app
from services.runtime import runtime


@pytest.fixture
def client(request):
    from config import get_config

    config = get_config()
    previous_mode, previous_key = config.demo_mode, config.ingest_api_key
    config.demo_mode = getattr(request, "param", "demo") != "hardware"
    config.ingest_api_key = "isolated-hardware-test-key-123456"
    Base.metadata.drop_all(engine)
    runtime.latest = None
    runtime.last_received = None
    runtime.started = time.monotonic()
    # asyncio locks must be recreated between TestClient event loops.
    import asyncio

    runtime.lock = asyncio.Lock()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        config.demo_mode, config.ingest_api_key = previous_mode, previous_key


@pytest.fixture
def db(client):
    from database import SessionLocal

    with SessionLocal() as session:
        yield session
