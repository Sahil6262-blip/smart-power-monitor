from typing import Protocol, Sequence

from ai.features import EnergyFeatures


class RecommendationProvider(Protocol):
    def recommend(self, window: Sequence[EnergyFeatures]) -> list[str]: ...
