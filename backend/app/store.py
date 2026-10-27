"""In-memory store of January 2026 wind actuals and forecasts.

January 2026 is history, so the data never changes. We ship a snapshot
(`backend/data/snapshot.json`, refreshed by `scripts/refresh_snapshot.py`) so
the app starts instantly and does not depend on Elexon being up. If the snapshot
is missing, the store falls back to fetching live from Elexon.
"""

import bisect
import json
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from . import elexon
from .config import FIRST_DELIVERY_DATE, LAST_DELIVERY_DATE
from .models import Actual, Forecast

SNAPSHOT_PATH = Path(__file__).resolve().parent.parent / "data" / "snapshot.json"

# Ranges with margin: the earliest delivery day may be forecast up to ~66h ahead.
ACTUALS_FROM = FIRST_DELIVERY_DATE - timedelta(days=1)
ACTUALS_TO = LAST_DELIVERY_DATE + timedelta(days=1)
PUBLISH_FROM = datetime(2025, 12, 29, tzinfo=UTC)
PUBLISH_TO = datetime(2026, 2, 2, tzinfo=UTC)


class Store:
    def __init__(self, actuals: list[Actual], forecasts: list[Forecast]):
        self.actuals = sorted(actuals, key=lambda a: a.start_time)
        self.actual_by_time = {a.start_time: a.generation for a in self.actuals}

        # Drop forecasts for times already in the past at publish time.
        forecasts = [f for f in forecasts if f.horizon_hours >= 0]

        by_vintage: dict[datetime, list[Forecast]] = defaultdict(list)
        by_target: dict[datetime, list[Forecast]] = defaultdict(list)
        for f in forecasts:
            by_vintage[f.publish_time].append(f)
            by_target[f.start_time].append(f)
        self.publish_times = sorted(by_vintage)
        self.by_vintage = {p: sorted(fs, key=lambda f: f.start_time) for p, fs in by_vintage.items()}
        self.by_target = {t: sorted(fs, key=lambda f: f.publish_time) for t, fs in by_target.items()}
        self._target_publish_index = {t: [f.publish_time for f in fs] for t, fs in self.by_target.items()}

    def latest_vintage_at(self, moment: datetime) -> datetime | None:
        """The most recent forecast run published at or before `moment`."""
        i = bisect.bisect_right(self.publish_times, moment)
        return self.publish_times[i - 1] if i else None

    def latest_forecast_for(self, target: datetime, published_by: datetime) -> Forecast | None:
        """The most recent forecast for `target` published at or before `published_by`."""
        publishes = self._target_publish_index.get(target)
        if not publishes:
            return None
        i = bisect.bisect_right(publishes, published_by)
        return self.by_target[target][i - 1] if i else None

    def actuals_between(self, start: datetime, end: datetime) -> list[Actual]:
        return [a for a in self.actuals if start <= a.start_time < end]


def _load_snapshot(path: Path) -> Store:
    raw = json.loads(path.read_text())
    parse = lambda s: datetime.fromisoformat(s).replace(tzinfo=UTC)  # noqa: E731
    actuals = [Actual(parse(t), g) for t, g in raw["actuals"]]
    forecasts = [Forecast(parse(p), parse(t), g) for p, t, g in raw["forecasts"]]
    return Store(actuals, forecasts)


def fetch_live() -> tuple[list[Actual], list[Forecast]]:
    return (
        elexon.fetch_wind_actuals(ACTUALS_FROM, ACTUALS_TO),
        elexon.fetch_wind_forecasts(PUBLISH_FROM, PUBLISH_TO),
    )


def write_snapshot(actuals: list[Actual], forecasts: list[Forecast], path: Path = SNAPSHOT_PATH) -> None:
    fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M")  # noqa: E731
    payload = {
        "source": "Elexon BMRS FUELHH (fuelType=WIND) and WINDFOR",
        "actuals": [[fmt(a.start_time), a.generation] for a in sorted(actuals, key=lambda a: a.start_time)],
        "forecasts": [
            [fmt(f.publish_time), fmt(f.start_time), f.generation]
            for f in sorted(forecasts, key=lambda f: (f.publish_time, f.start_time))
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


@lru_cache(maxsize=1)
def get_store() -> Store:
    if SNAPSHOT_PATH.exists():
        return _load_snapshot(SNAPSHOT_PATH)
    return Store(*fetch_live())


def delivery_dates() -> list[date]:
    days = (LAST_DELIVERY_DATE - FIRST_DELIVERY_DATE).days + 1
    return [FIRST_DELIVERY_DATE + timedelta(days=i) for i in range(days)]
