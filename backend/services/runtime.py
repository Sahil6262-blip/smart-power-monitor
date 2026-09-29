import asyncio
import logging
import time
from contextlib import suppress

from sqlalchemy import func, select

from config import get_config
from database import Base, SessionLocal, engine
from models import Alert, Reading, Settings
from schemas import AlertOut, LiveMessage, ReadingOut
from services.aggregation import aggregate_reading
from services.alert_engine import evaluate, sync_rule
from services.calculations import health_score, month_budget, period_bounds, summarize
from services.seed import seed_history
from services.sources import HardwareSource, Simulator
from websocket import manager

log = logging.getLogger(__name__)


class Runtime:
    def __init__(self):
        self.started = time.monotonic()
        self.latest = None
        self.last_received = None
        self.storage_ok = True
        self.source = None
        self.task = None
        self.lock = asyncio.Lock()

    def initialize(self):
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            if db.get(Settings, 1) is None:
                db.add(Settings(id=1))
                db.commit()
            if get_config().demo_mode and get_config().seed_demo_history:
                seed_history(db)
            last = db.scalar(
                select(Reading)
                .where(Reading.source == get_config().source)
                .order_by(Reading.timestamp.desc())
                .limit(1)
            )
            self.source = (
                Simulator(last.energy if last else 0)
                if get_config().demo_mode
                else HardwareSource()
            )
            # Historical records never count as a fresh source heartbeat.

    def persist(self, data):
        with SessionLocal() as db:
            settings = db.get(Settings, 1)
            previous = db.scalar(
                select(Reading)
                .where(Reading.source == get_config().source)
                .order_by(Reading.timestamp.desc())
                .limit(1)
            )
            if previous and data.timestamp <= previous.timestamp:
                raise ValueError(
                    "Reading timestamps must increase; duplicate or out-of-order reading"
                )
            seconds = (data.timestamp - previous.timestamp).total_seconds() if previous else 0
            # A reset starts a new meter segment; never record negative consumption.
            delta = max(0, data.energy - previous.energy) if previous else 0
            if previous and data.energy < previous.energy:
                delta = data.energy
            reading = Reading(
                **data.model_dump(),
                source=get_config().source,
                energy_delta=delta,
                interval_seconds=seconds,
            )
            db.add(reading)
            db.flush()
            budget = month_budget(db, settings)
            created = evaluate(db, reading, previous, settings, budget)
            aggregate_reading(db, reading, len(created))
            db.flush()
            active_count = db.scalar(
                select(func.count(Alert.id)).where(
                    Alert.source == get_config().source, Alert.status != "resolved"
                )
            )
            summary = summarize(db, *period_bounds("today"), settings)
            score = health_score(reading, settings, active_count, budget)
            message = LiveMessage(
                **ReadingOut.model_validate(reading).model_dump(),
                system_status="attention" if active_count else "normal",
                alerts=[AlertOut.model_validate(a) for a in created],
                active_alert_count=active_count,
                health_score=score,
                today=summary,
                budget=budget,
            )
            db.commit()
            return message.model_dump(mode="json")

    async def ingest(self, data):
        async with self.lock:
            message = await asyncio.to_thread(self.persist, data)
            self.latest = message
            self.last_received = time.monotonic()
            self.storage_ok = True
            manager.broadcast(message)
            return message

    def watchdog(self):
        elapsed = time.monotonic() - (self.last_received or self.started)
        with SessionLocal() as db:
            settings = db.get(Settings, 1)
            alert = sync_rule(
                db,
                get_config().source,
                "data_connection_lost",
                elapsed >= settings.connection_timeout_seconds,
                round(elapsed),
                settings.connection_timeout_seconds,
                "critical",
                "No fresh data has arrived from the source.",
            )
            result = AlertOut.model_validate(alert).model_dump(mode="json") if alert else None
            db.commit()
            return result

    async def run(self):
        deadline = time.monotonic()
        while True:
            try:
                # Hardware mode is push-only. Never invoke any sampler in this mode.
                data = self.source.sample() if get_config().demo_mode else None
                if data:
                    await self.ingest(data)
                else:
                    async with self.lock:
                        alert = await asyncio.to_thread(self.watchdog)
                    self.storage_ok = True
                    if alert:
                        manager.broadcast({"type": "alerts_changed", "alerts": [alert]})
            except asyncio.CancelledError:
                raise
            except Exception:
                self.storage_ok = False
                log.exception("Data pipeline failed; retrying next tick")
                manager.broadcast(
                    {
                        "type": "status",
                        "storage_status": "unavailable",
                        "message": "Storage unavailable; reconnecting.",
                    }
                )
            deadline += 1
            await asyncio.sleep(max(0.05, deadline - time.monotonic()))
            if deadline < time.monotonic() - 1:
                deadline = time.monotonic()

    async def start(self):
        await asyncio.to_thread(self.initialize)
        self.task = asyncio.create_task(self.run(), name="power-pipeline")

    async def stop(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
        await manager.close()
        await asyncio.to_thread(engine.dispose)


runtime = Runtime()
