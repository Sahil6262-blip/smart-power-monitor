from sqlalchemy import select

from models import MinuteAggregate


def aggregate_reading(db, reading, alert_count=0):
    """Incremental minute rollups, ready for a later raw-data retention job.

    Means are sample-weighted; energy_difference is the sum of meter deltas.
    No raw data is deleted by this service.
    """
    minute = reading.timestamp.replace(second=0, microsecond=0)
    row = db.scalar(
        select(MinuteAggregate).where(
            MinuteAggregate.source == reading.source, MinuteAggregate.timestamp == minute
        )
    )
    if row is None:
        row = MinuteAggregate(
            timestamp=minute,
            source=reading.source,
            count=1,
            avg_voltage=reading.voltage,
            avg_current=reading.current,
            avg_power=reading.power,
            min_voltage=reading.voltage,
            max_voltage=reading.voltage,
            peak_current=reading.current,
            peak_power=reading.power,
            avg_power_factor=reading.power_factor,
            energy_difference=reading.energy_delta,
            alert_count=alert_count,
        )
        db.add(row)
        return
    for target, origin in [
        ("avg_voltage", "voltage"),
        ("avg_current", "current"),
        ("avg_power", "power"),
        ("avg_power_factor", "power_factor"),
    ]:
        setattr(
            row,
            target,
            (getattr(row, target) * row.count + getattr(reading, origin)) / (row.count + 1),
        )
    row.count += 1
    row.min_voltage = min(row.min_voltage, reading.voltage)
    row.max_voltage = max(row.max_voltage, reading.voltage)
    row.peak_current = max(row.peak_current, reading.current)
    row.peak_power = max(row.peak_power, reading.power)
    row.energy_difference += reading.energy_delta
    row.alert_count += alert_count
