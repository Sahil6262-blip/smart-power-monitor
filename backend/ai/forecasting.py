from dataclasses import dataclass
from typing import Protocol, Sequence

from ai.features import EnergyFeatures


@dataclass(frozen=True)
class Forecast:
    prediction_type: str
    predicted_value: float
    confidence: float | None
    model_version: str


class Forecaster(Protocol):
    def predict(self, window: Sequence[EnergyFeatures], horizon_hours: int) -> list[Forecast]: ...
