import time
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from config import get_config
from database import SessionLocal, utcnow
from models import Alert, MinuteAggregate, Reading, Settings
from schemas import Budget, ReadingIn
from services.aggregation import aggregate_reading
from services.alert_engine import evaluate, sync_rule
from services.calculations import health_score, period_bounds, summarize
from services.runtime import runtime


def payload(**updates):
    return (
        dict(
            timestamp=utcnow(),
            voltage=230,
            current=2,
            power=430,
            energy=2.0,
            frequency=50,
            power_factor=0.94,
        )
        | updates
    )


def wait_live(client):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        response = client.get("/api/live")
        if response.status_code == 200:
            return response.json()
        time.sleep(0.05)
    raise AssertionError("No live reading within three seconds")


def test_demo_endpoints_and_exports(client):
    reading = wait_live(client)
    assert 220 < reading["voltage"] < 240
    assert reading["source"] == "demo"
    assert reading["timestamp"].endswith("Z")
    for path in [
        "/api/health",
        "/api/history?range=today",
        "/api/history/trend?range=1m",
        "/api/consumption/today",
        "/api/consumption/week",
        "/api/consumption/month",
        "/api/consumption/budget",
        "/api/alerts",
        "/api/alerts/history",
        "/api/settings",
        "/api/reports",
        "/api/predictions",
    ]:
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)
    csv = client.get("/api/history/export?range=today")
    assert (
        "timestamp,source,voltage" in csv.text
        and "attachment" in csv.headers["content-disposition"]
    )
    assert "estimated_cost" in client.get("/api/reports/export").text
    assert client.get("/api/predictions").json()["predictions"] == []


def test_websocket_cadence_multiple_clients_and_invalid_messages(client):
    with (
        client.websocket_connect("/ws/live") as first,
        client.websocket_connect("/ws/live") as second,
    ):
        first.send_text("{not json")
        one = first.receive_json()
        two = first.receive_json()
        assert one["type"] == two["type"] == "reading"
        gap = (
            datetime.fromisoformat(two["timestamp"]) - datetime.fromisoformat(one["timestamp"])
        ).total_seconds()
        assert 0.7 <= gap <= 1.5
        assert two["energy"] > one["energy"]
        assert second.receive_json()["type"] == "reading"
        assert client.get("/api/health").json()["websocket_clients"] == 2
    with client.websocket_connect("/ws/live") as reconnected:
        assert reconnected.receive_json()["type"] == "reading"


def test_settings_validation_persistence_and_alert_lifecycle(client):
    settings = client.get("/api/settings").json()
    invalid = settings | {"min_voltage": settings["max_voltage"] + 1}
    assert client.put("/api/settings", json=invalid).status_code == 422
    assert client.put("/api/settings", json=settings | {"tariff": -1}).status_code == 422
    update = settings | {"max_power": 50, "tariff": 9.25}
    assert client.put("/api/settings", json=update).status_code == 200
    with SessionLocal() as db:
        assert db.get(Settings, 1).tariff == 9.25
    deadline = time.monotonic() + 4
    events = []
    while time.monotonic() < deadline:
        events = client.get("/api/alerts?status=open").json()
        if any(a["type"] == "high_power" for a in events):
            break
        time.sleep(0.1)
    event = next(a for a in events if a["type"] == "high_power")
    assert client.patch(f"/api/alerts/{event['id']}", json={"status": "acknowledged"}).json()[
        "acknowledged_at"
    ]
    client.put("/api/settings", json=settings)
    assert client.patch(f"/api/alerts/{event['id']}", json={"status": "resolved"}).json()[
        "resolved_at"
    ]
    assert (
        client.patch(f"/api/alerts/{event['id']}", json={"status": "acknowledged"}).status_code
        == 409
    )


def test_rules_deduplicate_resolve_and_roll_up(db):
    settings = db.get(Settings, 1)
    reading = Reading(
        **payload(voltage=270, current=12, power=2500, power_factor=0.7),
        source="hardware",
        energy_delta=0.01,
        interval_seconds=1,
    )
    previous = Reading(**payload(power=400), source="hardware")
    budget = Budget(target=10, used=11, remaining=0, percentage=110)
    alerts = evaluate(db, reading, previous, settings, budget)
    assert {a.type for a in alerts} == {
        "high_voltage",
        "high_current",
        "high_power",
        "low_power_factor",
        "sudden_power_increase",
        "energy_budget_exceeded",
    }
    assert evaluate(db, reading, previous, settings, budget) == []
    aggregate_reading(db, reading, len(alerts))
    db.flush()
    reading.voltage = 190
    evaluate(db, reading, previous, settings, budget)
    db.flush()
    assert (
        db.scalar(
            select(Alert).where(Alert.source == "hardware", Alert.type == "high_voltage")
        ).status
        == "resolved"
    )
    assert (
        db.scalar(
            select(Alert).where(Alert.source == "hardware", Alert.type == "low_voltage")
        ).status
        == "active"
    )
    aggregate_reading(db, reading)
    db.flush()
    aggregate = db.scalar(select(MinuteAggregate).where(MinuteAggregate.source == "hardware"))
    assert aggregate.count == 2 and aggregate.avg_voltage == 230
    assert aggregate.min_voltage == 190 and aggregate.max_voltage == 270
    assert aggregate.energy_difference == pytest.approx(0.02)
    assert aggregate.alert_count == 6
    score = health_score(reading, settings, 6, budget)
    assert score.score == max(0, 100 - sum(f["penalty"] for f in score.factors))
    assert sync_rule(
        db, "hardware", "data_connection_lost", True, 12, 10, "critical", "Connection lost"
    )
    assert (
        sync_rule(
            db, "hardware", "data_connection_lost", True, 13, 10, "critical", "Connection lost"
        )
        is None
    )
    sync_rule(db, "hardware", "data_connection_lost", False, 0, 10, "critical", "Connection lost")
    db.flush()
    assert (
        db.scalar(
            select(Alert).where(Alert.source == "hardware", Alert.type == "data_connection_lost")
        ).status
        == "resolved"
    )


def test_history_validation_pagination_and_timezone(client):
    wait_live(client)
    for path in [
        "/api/history?range=unknown",
        "/api/history?page=0",
        "/api/history?page_size=10000",
        "/api/history?range=custom&start=2026-01-01&end=2026-01-02",
        "/api/history?range=custom&start=2026-01-01T00:00:00Z&end=2026-12-01T00:00:00Z",
        "/api/alerts?start=2026-01-01",
    ]:
        assert client.get(path).status_code == 422, path
    a, b = period_bounds("today")
    assert a.hour == 18 and a.minute == 30  # Local midnight Asia/Kolkata in UTC.
    assert a.tzinfo is not None and b > a
    result = client.get("/api/history?page_size=1").json()
    assert len(result["items"]) == 1 and result["total"] >= 1


def test_validation_rejects_nonfinite_naive_and_negative():
    for updates in [
        {"voltage": float("nan")},
        {"power": -1},
        {"power_factor": 1.5},
        {"timestamp": datetime.now()},
    ]:
        with pytest.raises(ValidationError):
            ReadingIn(**payload(**updates))


def test_hardware_ingestion_key_order_and_meter_reset(client):
    config = get_config()
    original_mode, original_key = config.demo_mode, config.ingest_api_key
    try:
        config.demo_mode = False
        config.ingest_api_key = "a-test-key-at-least-16-chars"
        stamp = utcnow() + timedelta(seconds=1)
        data = ReadingIn(**payload(timestamp=stamp, energy=10)).model_dump(mode="json")
        assert client.post("/api/readings", json=data).status_code == 401
        headers = {"X-Ingest-Key": config.ingest_api_key}
        assert client.post("/api/readings", json=data, headers=headers).status_code == 201
        assert client.post("/api/readings", json=data, headers=headers).status_code == 409
        reset = data | {"timestamp": (stamp + timedelta(seconds=1)).isoformat(), "energy": 0.002}
        assert client.post("/api/readings", json=reset, headers=headers).status_code == 201
        with SessionLocal() as db:
            latest = db.scalar(
                select(Reading)
                .where(Reading.source == "hardware")
                .order_by(Reading.timestamp.desc())
                .limit(1)
            )
            assert latest.energy_delta == pytest.approx(0.002)
        stale = data | {"timestamp": (stamp - timedelta(minutes=5)).isoformat()}
        assert client.post("/api/readings", json=stale, headers=headers).status_code == 422
    finally:
        config.demo_mode, config.ingest_api_key = original_mode, original_key


def test_pipeline_recovers_from_transient_database_error(client):
    first = wait_live(client)
    with patch.object(
        runtime,
        "persist",
        side_effect=OperationalError("temporary disconnect", {}, Exception("offline")),
    ):
        deadline = time.monotonic() + 3
        while runtime.storage_ok and time.monotonic() < deadline:
            time.sleep(0.05)
        assert not runtime.storage_ok
    deadline = time.monotonic() + 3
    while (
        not runtime.storage_ok or runtime.latest["timestamp"] == first["timestamp"]
    ) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert runtime.storage_ok and runtime.latest["timestamp"] > first["timestamp"]
    assert client.get("/api/health").json()["database"] == "connected"


def test_cumulative_meter_is_not_daily_consumption(db):
    stamp = utcnow() - timedelta(hours=24)
    # Records in their own earlier window; lifetime counter must not become daily usage.
    for i, energy in enumerate([500.0, 500.25, 500.5]):
        db.add(
            Reading(
                **payload(timestamp=stamp + timedelta(seconds=i), energy=energy),
                source="demo",
                energy_delta=0 if i == 0 else 0.25,
                interval_seconds=1,
            )
        )
    db.flush()
    summary = summarize(db, stamp, stamp + timedelta(seconds=3))
    assert summary.energy_kwh == pytest.approx(0.5)
    assert summary.estimated_cost == pytest.approx(0.5 * db.get(Settings, 1).tariff)
