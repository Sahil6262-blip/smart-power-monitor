from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ReadingIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    timestamp: datetime
    voltage: float = Field(ge=0, le=1000)
    current: float = Field(ge=0, le=1000)
    power: float = Field(ge=0, le=1_000_000)
    energy: float = Field(ge=0)
    frequency: float = Field(ge=0, le=100)
    power_factor: float = Field(ge=0, le=1)

    @field_validator("timestamp")
    @classmethod
    def aware_timestamp(cls, value):
        if value.tzinfo is None:
            raise ValueError("An ISO-8601 timestamp with timezone is required")
        return value.astimezone(timezone.utc)


class ReadingOut(ReadingIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source: str


class SettingsIn(BaseModel):
    model_config = ConfigDict(from_attributes=True, allow_inf_nan=False, extra="forbid")
    tariff: float = Field(ge=0, le=1000)
    min_voltage: float = Field(ge=0, le=1000)
    max_voltage: float = Field(gt=0, le=1000)
    max_current: float = Field(gt=0, le=1000)
    max_power: float = Field(gt=0, le=1_000_000)
    min_power_factor: float = Field(gt=0, le=1)
    monthly_energy_target: float = Field(gt=0, le=1_000_000)
    sudden_power_increase: float = Field(gt=0, le=1_000_000)
    connection_timeout_seconds: int = Field(ge=5, le=120)

    @model_validator(mode="after")
    def ordered_voltage(self):
        if self.min_voltage >= self.max_voltage:
            raise ValueError("Minimum voltage must be less than maximum voltage")
        return self


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    timestamp: datetime
    type: str
    severity: Literal["info", "warning", "critical"]
    message: str
    measured_value: float
    threshold_value: float
    status: Literal["active", "acknowledged", "resolved"]
    acknowledged_at: datetime | None
    resolved_at: datetime | None


class AlertUpdate(BaseModel):
    status: Literal["acknowledged", "resolved"]


class HistoryResponse(BaseModel):
    items: list[ReadingOut]
    total: int
    page: int
    page_size: int


class TrendPoint(BaseModel):
    timestamp: datetime
    voltage: float
    current: float
    power: float
    energy: float
    frequency: float
    power_factor: float


class Summary(BaseModel):
    start: datetime
    end: datetime
    energy_kwh: float
    estimated_cost: float
    tariff: float
    average_power: float
    peak_power: float
    peak_time: datetime | None
    average_pf: float
    min_voltage: float
    max_voltage: float
    alert_count: int
    reading_count: int
    source: str


class Bucket(BaseModel):
    timestamp: datetime
    energy_kwh: float
    estimated_cost: float


class ConsumptionResponse(BaseModel):
    summary: Summary
    buckets: list[Bucket]


class Budget(BaseModel):
    target: float
    used: float
    remaining: float
    percentage: float


class HealthScore(BaseModel):
    score: int
    label: str
    factors: list[dict]
    description: str = "Application heuristic, not an industry-certified metric."


class LiveMessage(ReadingOut):
    type: Literal["reading"] = "reading"
    system_status: str
    alerts: list[AlertOut]
    active_alert_count: int
    health_score: HealthScore
    today: Summary
    budget: Budget
    storage_status: str = "connected"


class DeviceHealth(BaseModel):
    status: str
    database: str
    source: str
    source_status: str
    last_reading: datetime | None
    uptime_seconds: int
    reading_count: int
    active_alerts: int
    websocket_clients: int
    timezone: str
    database_engine: str
    storage_bytes: int | None
    error: str | None = None


class PredictionsResponse(BaseModel):
    status: Literal["not_configured"] = "not_configured"
    model_version: str | None = None
    predictions: list = []
    capabilities: list[str]
    message: str
