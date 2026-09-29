import asyncio
import hmac
import time
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError

from config import get_config
from database import engine, get_db, utcnow
from models import Alert, Reading
from schemas import DeviceHealth, LiveMessage, ReadingIn
from services.runtime import runtime
from websocket import manager

router = APIRouter(tags=["Live and device"])


@router.get("/api/live", response_model=LiveMessage)
def live():
    if not runtime.latest:
        raise HTTPException(503, "Waiting for the first live reading")
    return runtime.latest


@router.post("/api/readings", response_model=LiveMessage, status_code=201)
async def ingest(data: ReadingIn, x_ingest_key: str = Header(default="")):
    config = get_config()
    if config.demo_mode:
        raise HTTPException(409, "Disable DEMO_MODE before sending hardware data")
    if not hmac.compare_digest(x_ingest_key, config.ingest_api_key):
        raise HTTPException(401, "Invalid ingestion key")
    if abs((utcnow() - data.timestamp).total_seconds()) > 60:
        raise HTTPException(422, "Hardware timestamp must be within 60 seconds of server time")
    try:
        return await runtime.ingest(data)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/api/health", response_model=DeviceHealth)
def health(db=Depends(get_db)):
    config = get_config()
    connected = False
    count, active = 0, 0
    try:
        db.execute(text("SELECT 1"))
        count = db.scalar(select(func.count(Reading.id)).where(Reading.source == config.source))
        active = db.scalar(
            select(func.count(Alert.id)).where(
                Alert.source == config.source, Alert.status != "resolved"
            )
        )
        connected = True
    except SQLAlchemyError:
        db.rollback()
    age = time.monotonic() - (runtime.last_received or runtime.started)
    source_status = (
        "live" if runtime.last_received and age < 3 else "waiting" if age < 10 else "offline"
    )
    storage = None
    if engine.dialect.name == "sqlite" and engine.url.database:
        path = Path(engine.url.database)
        storage = sum(p.stat().st_size for p in (path, Path(str(path) + "-wal")) if p.exists())
    return DeviceHealth(
        status="ok" if connected and source_status == "live" else "degraded",
        database="connected" if connected else "unavailable",
        source=config.source,
        source_status=source_status,
        last_reading=runtime.latest["timestamp"] if runtime.latest else None,
        uptime_seconds=int(time.monotonic() - runtime.started),
        reading_count=count,
        active_alerts=active,
        websocket_clients=len(manager.clients),
        timezone=config.timezone,
        database_engine=engine.dialect.name,
        storage_bytes=storage,
        error=None if connected else "Database unavailable; pipeline will retry automatically",
    )


@router.websocket("/ws/live")
async def websocket_live(socket: WebSocket):
    origin = socket.headers.get("origin")
    if origin and origin not in get_config().origins:
        await socket.close(code=1008)
        return
    queue = await manager.connect(socket)
    if runtime.latest:
        queue.put_nowait(runtime.latest)

    async def send():
        while True:
            message = await queue.get()
            await asyncio.wait_for(socket.send_json(message), timeout=5)

    async def receive():
        while True:
            raw = await socket.receive_text()
            if len(raw) > 1024:
                await socket.close(code=1009)
                return
            # Server-push stream; unknown/invalid messages never reach ingestion.
            if raw == "ping":
                if not queue.full():
                    queue.put_nowait({"type": "pong"})

    tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        manager.disconnect(socket)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
