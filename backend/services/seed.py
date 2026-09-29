import math
import random
from datetime import timedelta

from sqlalchemy import select

from database import utcnow
from models import Alert, Reading


def seed_history(db):
    """One-time, explicitly simulated 32-day history at five-minute resolution."""
    if db.scalar(select(Reading.id).where(Reading.source == "demo").limit(1)):
        return
    rng = random.Random(42)
    now = utcnow()
    start = (now - timedelta(days=32)).replace(second=0, microsecond=0)
    cursor = start
    energy = 0.0
    rows = []
    while cursor < now - timedelta(seconds=300):
        local_hour = (cursor.hour + 5.5 + cursor.minute / 60) % 24
        demand = (
            110
            + 430 * math.exp(-(((local_hour - 19) / 3.0) ** 2))
            + 210 * math.exp(-(((local_hour - 9) / 2.5) ** 2))
        )
        power = max(60, demand * rng.uniform(0.8, 1.2))
        voltage = rng.uniform(227, 233)
        pf = rng.uniform(0.89, 0.98)
        delta = power * 300 / 3_600_000
        energy += delta
        rows.append(
            dict(
                timestamp=cursor,
                source="demo",
                voltage=round(voltage, 2),
                current=round(power / voltage / pf, 3),
                power=round(power, 2),
                energy=round(energy, 8),
                frequency=round(rng.uniform(49.94, 50.06), 2),
                power_factor=round(pf, 3),
                energy_delta=delta,
                interval_seconds=300,
            )
        )
        cursor += timedelta(minutes=5)
    # A recent 1 Hz tail makes the first live chart useful immediately.
    previous_at = rows[-1]["timestamp"]
    for i in range(300, 0, -1):
        stamp = now - timedelta(seconds=i)
        power = 490 + 100 * math.sin(stamp.timestamp() / 27) + 30 * math.sin(stamp.timestamp() / 5)
        seconds = (stamp - previous_at).total_seconds()
        if seconds <= 0:
            continue
        delta = power * seconds / 3_600_000
        energy += delta
        rows.append(
            dict(
                timestamp=stamp,
                source="demo",
                voltage=230.1,
                current=round(power / 230.1 / 0.94, 3),
                power=round(power, 2),
                energy=energy,
                frequency=50.0,
                power_factor=0.94,
                energy_delta=delta,
                interval_seconds=seconds,
            )
        )
        previous_at = stamp
    db.bulk_insert_mappings(Reading, rows)
    for hours, kind, value, limit, severity, message in [
        (
            2,
            "low_power_factor",
            0.82,
            0.85,
            "warning",
            "Simulated event: power factor recovered after a brief dip.",
        ),
        (
            7,
            "sudden_power_increase",
            820,
            700,
            "info",
            "Simulated event: a load increase was detected.",
        ),
        (
            25,
            "high_voltage",
            253,
            250,
            "critical",
            "Simulated event: voltage returned to its normal range.",
        ),
    ]:
        stamp = now - timedelta(hours=hours)
        db.add(
            Alert(
                timestamp=stamp,
                source="demo",
                type=kind,
                severity=severity,
                message=message,
                measured_value=value,
                threshold_value=limit,
                status="resolved",
                resolved_at=stamp + timedelta(minutes=3),
            )
        )
    db.commit()
