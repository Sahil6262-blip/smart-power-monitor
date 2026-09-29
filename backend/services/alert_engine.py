from sqlalchemy import select

from database import utcnow
from models import Alert


def sync_rule(db, source, kind, triggered, measured, threshold, severity, message):
    existing = db.scalar(
        select(Alert).where(Alert.source == source, Alert.type == kind, Alert.status != "resolved")
    )
    if triggered:
        if existing:
            return None
        alert = Alert(
            source=source,
            type=kind,
            severity=severity,
            message=message,
            measured_value=measured,
            threshold_value=threshold,
            status="active",
            timestamp=utcnow(),
        )
        db.add(alert)
        db.flush()
        return alert
    if existing:
        existing.status = "resolved"
        existing.resolved_at = utcnow()
    return None


def evaluate(db, reading, previous, settings, budget):
    rules = [
        (
            "high_voltage",
            reading.voltage > settings.max_voltage,
            reading.voltage,
            settings.max_voltage,
            "critical",
            "Voltage exceeds the configured upper limit.",
        ),
        (
            "low_voltage",
            reading.voltage < settings.min_voltage,
            reading.voltage,
            settings.min_voltage,
            "critical",
            "Voltage is below the configured lower limit.",
        ),
        (
            "high_current",
            reading.current > settings.max_current,
            reading.current,
            settings.max_current,
            "critical",
            "Current exceeds the configured load limit.",
        ),
        (
            "high_power",
            reading.power > settings.max_power,
            reading.power,
            settings.max_power,
            "warning",
            "Active power exceeds the configured limit.",
        ),
        (
            "low_power_factor",
            reading.power_factor < settings.min_power_factor,
            reading.power_factor,
            settings.min_power_factor,
            "warning",
            "Power factor is below the configured minimum.",
        ),
        (
            "sudden_power_increase",
            previous is not None
            and reading.power - previous.power > settings.sudden_power_increase,
            reading.power - previous.power if previous else 0,
            settings.sudden_power_increase,
            "info",
            "A sudden increase in active power was detected.",
        ),
        (
            "energy_budget_exceeded",
            budget.used >= budget.target,
            budget.used,
            budget.target,
            "warning",
            "Monthly consumption has reached the energy budget.",
        ),
        (
            "data_connection_lost",
            False,
            0,
            settings.connection_timeout_seconds,
            "critical",
            "No fresh data has arrived from the source.",
        ),
    ]
    created = []
    for kind, trigger, value, limit, severity, message in rules:
        alert = sync_rule(db, reading.source, kind, trigger, value, limit, severity, message)
        if alert:
            created.append(alert)
    return created
