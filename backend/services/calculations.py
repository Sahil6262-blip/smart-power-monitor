from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select

from config import get_config
from models import Alert, Reading, Settings
from schemas import Budget, HealthScore, Summary


def period_bounds(period="today", start=None, end=None):
    now = datetime.now(timezone.utc)
    local = now.astimezone(ZoneInfo(get_config().timezone))
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "custom":
        if not start or not end or start.tzinfo is None or end.tzinfo is None:
            raise ValueError("Custom range requires timezone-aware start and end")
        a, b = start, end
    elif period == "yesterday":
        a, b = midnight - timedelta(days=1), midnight
    elif period in ("week", "7d"):
        a, b = midnight - timedelta(days=6), now
    elif period in ("30d", "last30"):
        a, b = midnight - timedelta(days=29), now
    elif period == "month":
        a, b = midnight.replace(day=1), now
    elif period in ("1m", "10m", "1h"):
        a, b = now - timedelta(seconds={"1m": 60, "10m": 600, "1h": 3600}[period]), now
    elif period == "today":
        a, b = midnight, now
    else:
        raise ValueError("Unsupported range")
    if a >= b or b - a > timedelta(days=93):
        raise ValueError("Range must be positive and at most 93 days")
    return a.astimezone(timezone.utc), b.astimezone(timezone.utc)


def reading_filter(start, end):
    return (
        Reading.source == get_config().source,
        Reading.timestamp >= start,
        Reading.timestamp < end,
    )


def summarize(db, start, end, settings=None):
    settings = settings or db.get(Settings, 1)
    row = db.execute(
        select(
            func.count(Reading.id),
            func.sum(Reading.energy_delta),
            func.sum(Reading.power * Reading.interval_seconds),
            func.sum(Reading.interval_seconds),
            func.avg(Reading.power_factor),
            func.min(Reading.voltage),
            func.max(Reading.voltage),
        ).where(*reading_filter(start, end))
    ).one()
    peak = db.scalar(
        select(Reading)
        .where(*reading_filter(start, end))
        .order_by(Reading.power.desc(), Reading.timestamp)
        .limit(1)
    )
    alerts = db.scalar(
        select(func.count(Alert.id)).where(
            Alert.source == get_config().source, Alert.timestamp >= start, Alert.timestamp < end
        )
    )
    energy = float(row[1] or 0)
    return Summary(
        start=start,
        end=end,
        energy_kwh=round(energy, 6),
        estimated_cost=round(energy * settings.tariff, 2),
        tariff=settings.tariff,
        average_power=round((row[2] or 0) / row[3], 2) if row[3] else 0,
        peak_power=peak.power if peak else 0,
        peak_time=peak.timestamp if peak else None,
        average_pf=round(row[4] or 0, 3),
        min_voltage=row[5] or 0,
        max_voltage=row[6] or 0,
        alert_count=alerts or 0,
        reading_count=row[0],
        source=get_config().source,
    )


def month_budget(db, settings):
    a, b = period_bounds("month")
    used = float(
        db.scalar(select(func.sum(Reading.energy_delta)).where(*reading_filter(a, b))) or 0
    )
    return Budget(
        target=settings.monthly_energy_target,
        used=round(used, 4),
        remaining=round(max(0, settings.monthly_energy_target - used), 4),
        percentage=round(used / settings.monthly_energy_target * 100, 2),
    )


def health_score(reading, settings, active_count, budget):
    """Transparent rule penalties. No prediction or trained model is involved."""
    factors = [
        {
            "name": "Voltage range",
            "penalty": 25
            if not settings.min_voltage <= reading.voltage <= settings.max_voltage
            else 0,
        },
        {
            "name": "Power factor",
            "penalty": round(
                min(25, max(0, settings.min_power_factor - reading.power_factor) * 100)
            ),
        },
        {
            "name": "Load limit",
            "penalty": 20
            if reading.power > settings.max_power or reading.current > settings.max_current
            else 0,
        },
        {"name": "Open alerts", "penalty": min(20, active_count * 5)},
        {
            "name": "Monthly budget",
            "penalty": 10 if budget.percentage >= 100 else 5 if budget.percentage >= 85 else 0,
        },
    ]
    score = max(0, 100 - sum(f["penalty"] for f in factors))
    return HealthScore(
        score=score,
        label="Excellent"
        if score >= 90
        else "Good"
        if score >= 75
        else "Attention"
        if score >= 50
        else "Critical",
        factors=factors,
    )


def consumption_buckets(db, start, end, granularity, settings):
    zone = ZoneInfo(get_config().timezone)
    cursor = start.astimezone(zone)
    boundaries = []
    while cursor < end:
        if granularity == "hourly":
            next_at = cursor.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        elif granularity == "weekly":
            next_at = cursor.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=7)
        elif granularity == "monthly":
            next_at = (cursor.replace(day=28) + timedelta(days=4)).replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            )
        else:
            next_at = cursor.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        boundaries.append(
            (cursor.astimezone(timezone.utc), min(next_at.astimezone(timezone.utc), end))
        )
        cursor = next_at
    bucket = case(
        *[(Reading.timestamp < b, i) for i, (_, b) in enumerate(boundaries)], else_=len(boundaries)
    )
    rows = db.execute(
        select(bucket.label("bucket"), func.sum(Reading.energy_delta))
        .where(*reading_filter(start, end))
        .group_by(bucket)
    ).all()
    totals = dict(rows)
    return [
        {
            "timestamp": a,
            "energy_kwh": round(totals.get(i, 0) or 0, 6),
            "estimated_cost": round((totals.get(i, 0) or 0) * settings.tariff, 2),
        }
        for i, (a, _) in enumerate(boundaries)
    ]
