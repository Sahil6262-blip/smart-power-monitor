import time
from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from config import get_config
from database import SessionLocal, utcnow
from models import Alert, MinuteAggregate, Reading
from services.runtime import runtime
from services.sources import HardwareSource, Simulator


@pytest.mark.parametrize("client", ["hardware"], indirect=True)
def test_hardware_end_to_end_without_any_simulation(client):
    assert get_config().demo_mode is False
    assert isinstance(runtime.source, HardwareSource)
    assert client.get("/api/health").json()["source"] == "hardware"
    assert client.get("/api/live").status_code == 503
    headers = {"X-Ingest-Key": get_config().ingest_api_key}
    stamp = utcnow() - timedelta(seconds=3)
    data = dict(
        timestamp=stamp.isoformat(),
        voltage=230.4,
        current=2.0,
        power=430,
        energy=100.0,
        frequency=50.0,
        power_factor=0.94,
    )

    with (
        patch.object(
            Simulator, "sample", side_effect=AssertionError("Simulator must not run")
        ) as simulator,
        patch.object(
            HardwareSource, "sample", side_effect=AssertionError("Hardware must be push-only")
        ) as hardware,
    ):
        time.sleep(1.2)
        assert client.get("/api/health").json()["reading_count"] == 0
        assert client.post("/api/readings", json=data).status_code == 401
        assert (
            client.post(
                "/api/readings", json=data, headers={"X-Ingest-Key": "wrong-key"}
            ).status_code
            == 401
        )

        settings = client.get("/api/settings").json()
        client.put("/api/settings", json=settings | {"max_power": 500, "tariff": 8})
        with client.websocket_connect("/ws/live") as socket:
            baseline = client.post("/api/readings", json=data, headers=headers)
            assert baseline.status_code == 201
            first_event = socket.receive_json()
            assert first_event["source"] == "hardware"
            assert first_event["energy"] == 100.0
            assert first_event["today"]["energy_kwh"] == 0
            assert client.get("/api/live").json()["id"] == first_event["id"]

            next_data = data | {
                "timestamp": (stamp + timedelta(seconds=1)).isoformat(),
                "power": 750,
                "current": 3.46,
                "energy": 100.002,
            }
            updated = client.post("/api/readings", json=next_data, headers=headers)
            assert updated.status_code == 201
            event = socket.receive_json()
            assert event["type"] == "reading"
            assert event["power"] == 750
            assert event["today"]["energy_kwh"] == pytest.approx(0.002)
            assert event["today"]["estimated_cost"] == pytest.approx(0.02)
            assert event["health_score"]["score"] < 100
            assert any(a["type"] == "high_power" for a in event["alerts"])
            assert client.get("/api/live").json()["id"] == event["id"]

        with SessionLocal() as db:
            assert (
                db.scalar(select(func.count(Reading.id)).where(Reading.source == "hardware")) == 2
            )
            assert db.scalar(select(func.count(Reading.id)).where(Reading.source == "demo")) == 0
            assert db.scalar(select(Alert).where(Alert.type == "high_power")).status == "active"
            assert db.scalar(select(func.sum(MinuteAggregate.count))) == 2
        time.sleep(1.2)
        assert client.get("/api/health").json()["reading_count"] == 2
        simulator.assert_not_called()
        hardware.assert_not_called()
