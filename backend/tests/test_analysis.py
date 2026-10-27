from datetime import UTC, date, datetime, time, timedelta

import pytest

from app import analysis as an
from app.models import Actual, Forecast, Pair
from app.store import Store

UTC = UTC


def ts(day, hour, minute=0):
    return datetime(2026, 1, day, hour, minute, tzinfo=UTC)


@pytest.fixture
def store():
    """Two runs for 15 Jan: one before the 11:00 cutoff on the 14th, one after."""
    actuals = [Actual(ts(15, h, m), 1000.0) for h in range(24) for m in (0, 30)]
    early = [Forecast(ts(14, 9, 30), ts(15, h), 1200.0) for h in range(24)]
    late = [Forecast(ts(14, 11, 30), ts(15, h), 900.0) for h in range(24)]
    stale = [Forecast(ts(15, 12), ts(15, 6), 5000.0)]  # published after its target: dropped
    return Store(actuals, early + late + stale)


def test_decision_uses_latest_run_before_cutoff(store):
    vintage, forecasts = an.forecast_at_decision(store, date(2026, 1, 15), time(11, 0))
    assert vintage == ts(14, 9, 30)
    assert len(forecasts) == 24
    assert {f.generation for f in forecasts} == {1200.0}


def test_later_cutoff_picks_up_newer_run(store):
    vintage, _ = an.forecast_at_decision(store, date(2026, 1, 15), time(12, 0))
    assert vintage == ts(14, 11, 30)


def test_cutoff_before_any_run_returns_nothing(store):
    vintage, forecasts = an.forecast_at_decision(store, date(2026, 1, 15), time(6, 0))
    assert vintage is None and forecasts == []


def test_negative_horizon_forecasts_are_dropped(store):
    assert all(f.publish_time <= f.start_time for fs in store.by_target.values() for f in fs)


def test_latest_forecast_respects_publish_deadline(store):
    target = ts(15, 6)
    assert store.latest_forecast_for(target, target - timedelta(hours=20)).generation == 1200.0
    assert store.latest_forecast_for(target, target).generation == 900.0


def test_delivery_window_follows_uk_clock_change():
    start, end = an.delivery_window(date(2026, 3, 29))  # BST starts: 23-hour day
    assert (end - start) == timedelta(hours=23)


def test_metrics_sign_convention():
    pairs = [Pair(ts(15, 0), ts(14, 9), 1200, 1000), Pair(ts(15, 1), ts(14, 9), 800, 1000)]
    m = an.metrics(pairs)
    assert m["mae"] == 200
    assert m["bias"] == 0
    assert m["rmse"] == 200
    assert pairs[0].error == 200  # over-forecast is positive: a shortfall to buy


def test_quantile_matches_numpy_linear():
    assert an.quantile([1, 2, 3, 4], 0.5) == 2.5
    assert an.quantile([10], 0.9) == 10
    assert an.quantile([0, 10], 0.9) == 9


def test_buffers_cover_stated_share_of_hours():
    errors = list(range(100))
    b = {x["confidence"]: x["bufferMw"] for x in an.buffers(errors)}
    assert sum(e <= b[0.9] for e in errors) / len(errors) >= 0.9


def test_band_is_leave_one_out():
    per_day = {
        date(2026, 1, 2): [Pair(ts(2, 0), ts(1, 9), 100, 0)],
        date(2026, 1, 3): [Pair(ts(3, 0), ts(2, 9), 0, 0)],
    }
    lo, hi = an.band_from_other_days(per_day, date(2026, 1, 3))
    assert lo == hi == 100  # the 3rd's own error (0) is not used


def test_histogram_bins_are_contiguous():
    h = an.histogram([-600, 10, 1400], bin_mw=500)
    assert [b["fromMw"] for b in h] == [-1000, -500, 0, 500, 1000]
    assert sum(b["count"] for b in h) == 3
