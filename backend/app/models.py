"""Domain records. All timestamps are timezone-aware UTC."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Actual:
    start_time: datetime
    generation: float  # MW, half-hourly


@dataclass(frozen=True)
class Forecast:
    publish_time: datetime
    start_time: datetime
    generation: float  # MW, hourly

    @property
    def horizon_hours(self) -> float:
        return (self.start_time - self.publish_time).total_seconds() / 3600


@dataclass(frozen=True)
class Pair:
    """A forecast matched to the actual outturn at the same target time."""

    start_time: datetime
    publish_time: datetime
    forecast: float
    actual: float

    @property
    def error(self) -> float:
        """Forecast minus actual. Positive = wind over-forecast = shortfall to buy."""
        return self.forecast - self.actual

    @property
    def horizon_hours(self) -> float:
        return (self.start_time - self.publish_time).total_seconds() / 3600
