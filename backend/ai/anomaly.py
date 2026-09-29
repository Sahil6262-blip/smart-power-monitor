from typing import Protocol, Sequence

from ai.features import EnergyFeatures


class AnomalyDetector(Protocol):
    model_version: str

    def score(self, window: Sequence[EnergyFeatures]) -> float: ...
