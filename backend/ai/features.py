from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class EnergyFeatures:
    timestamp: datetime
    hour: int
    day_of_week: int
    voltage: float
    current: float
    power: float
    energy: float
    frequency: float
    power_factor: float
    rolling_mean_power: float
    rolling_std_power: float
    power_change: float
    peak_power: float
    daily_consumption: float
    night_baseline: float


# Feature extraction must use a past-only window to avoid training leakage.
# Optional pandas/scikit-learn/XGBoost dependencies belong to a future ML package.
