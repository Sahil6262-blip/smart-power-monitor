from datetime import datetime

from sqlalchemy import Float, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base, UTCDateTime, utcnow


class Reading(Base):
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    source: Mapped[str] = mapped_column(String(16))
    voltage: Mapped[float] = mapped_column(Float)
    current: Mapped[float] = mapped_column(Float)
    power: Mapped[float] = mapped_column(Float)
    energy: Mapped[float] = mapped_column(Float)
    frequency: Mapped[float] = mapped_column(Float)
    power_factor: Mapped[float] = mapped_column(Float)
    energy_delta: Mapped[float] = mapped_column(Float, default=0)
    interval_seconds: Mapped[float] = mapped_column(Float, default=0)
    __table_args__ = (
        UniqueConstraint("source", "timestamp"),
        Index("ix_readings_source_time", "source", "timestamp"),
    )


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    source: Mapped[str] = mapped_column(String(16))
    type: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16), index=True)
    message: Mapped[str] = mapped_column(String(300))
    measured_value: Mapped[float] = mapped_column(Float)
    threshold_value: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __table_args__ = (Index("ix_alerts_source_time", "source", "timestamp"),)


class Settings(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    tariff: Mapped[float] = mapped_column(Float, default=8.0)
    min_voltage: Mapped[float] = mapped_column(Float, default=210.0)
    max_voltage: Mapped[float] = mapped_column(Float, default=250.0)
    max_current: Mapped[float] = mapped_column(Float, default=10.0)
    max_power: Mapped[float] = mapped_column(Float, default=2000.0)
    min_power_factor: Mapped[float] = mapped_column(Float, default=0.85)
    monthly_energy_target: Mapped[float] = mapped_column(Float, default=250.0)
    sudden_power_increase: Mapped[float] = mapped_column(Float, default=700.0)
    connection_timeout_seconds: Mapped[int] = mapped_column(Integer, default=10)


class MinuteAggregate(Base):
    __tablename__ = "minute_aggregates"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    source: Mapped[str] = mapped_column(String(16))
    count: Mapped[int] = mapped_column(Integer, default=0)
    avg_voltage: Mapped[float] = mapped_column(Float)
    avg_current: Mapped[float] = mapped_column(Float)
    avg_power: Mapped[float] = mapped_column(Float)
    min_voltage: Mapped[float] = mapped_column(Float)
    max_voltage: Mapped[float] = mapped_column(Float)
    peak_current: Mapped[float] = mapped_column(Float)
    peak_power: Mapped[float] = mapped_column(Float)
    avg_power_factor: Mapped[float] = mapped_column(Float)
    energy_difference: Mapped[float] = mapped_column(Float, default=0)
    alert_count: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (UniqueConstraint("source", "timestamp"),)


class Prediction(Base):
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    prediction_type: Mapped[str] = mapped_column(String(64))
    predicted_value: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(100))
