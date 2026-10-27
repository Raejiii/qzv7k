"""Forecast selection and accuracy analysis.

Sign convention everywhere: error = forecast - actual (MW).
A positive error means wind was over-forecast, so the buyer is short and must
procure the difference elsewhere.
"""

import math
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from statistics import fmean

from .config import MAX_HORIZON_HOURS, UK_TZ
from .models import Forecast, Pair
from .store import Store, delivery_dates

# --- time helpers -----------------------------------------------------------


def delivery_window(day: date) -> tuple[datetime, datetime]:
    """UTC bounds of a UK-local delivery day (handles 23/25h clock-change days)."""
    start = datetime.combine(day, time(0), UK_TZ)
    end = datetime.combine(day + timedelta(days=1), time(0), UK_TZ)
    return start.astimezone(UTC), end.astimezone(UTC)


def decision_moment(day: date, cutoff: time) -> datetime:
    """The UTC moment of the buying decision: `cutoff` UK time on the day before delivery."""
    return datetime.combine(day - timedelta(days=1), cutoff, UK_TZ).astimezone(UTC)


def full_window() -> tuple[datetime, datetime]:
    days = delivery_dates()
    return delivery_window(days[0])[0], delivery_window(days[-1])[1]


# --- forecast selection -----------------------------------------------------


def forecast_at_decision(store: Store, day: date, cutoff: time) -> tuple[datetime | None, list[Forecast]]:
    """The forecast run a buyer would have seen at the decision cutoff, for one delivery day."""
    vintage = store.latest_vintage_at(decision_moment(day, cutoff))
    if vintage is None:
        return None, []
    start, end = delivery_window(day)
    return vintage, [f for f in store.by_vintage[vintage] if start <= f.start_time < end]


def to_pairs(store: Store, forecasts: list[Forecast]) -> list[Pair]:
    pairs = []
    for f in forecasts:
        actual = store.actual_by_time.get(f.start_time)
        if actual is not None:
            pairs.append(Pair(f.start_time, f.publish_time, f.generation, actual))
    return pairs


def day_ahead_pairs(store: Store, cutoff: time) -> dict[date, list[Pair]]:
    """Decision-time forecast vs actual, for every delivery day in the window."""
    return {day: to_pairs(store, forecast_at_decision(store, day, cutoff)[1]) for day in delivery_dates()}


def latest_before_delivery(store: Store, day: date) -> list[Forecast]:
    """For each hour of the day, the freshest forecast published before that hour began."""
    start, end = delivery_window(day)
    out = []
    for target in sorted(t for t in store.by_target if start <= t < end):
        f = store.latest_forecast_for(target, target)
        if f is not None:
            out.append(f)
    return out


def horizon_pairs(store: Store, horizon_hours: float) -> list[Pair]:
    """For each target hour in the window, the latest forecast made at least `horizon_hours` earlier."""
    start, end = full_window()
    out = []
    for target in sorted(t for t in store.by_target if start <= t < end):
        f = store.latest_forecast_for(target, target - timedelta(hours=horizon_hours))
        if f is not None:
            out.extend(to_pairs(store, [f]))
    return out


def all_window_pairs(store: Store, max_horizon: float = MAX_HORIZON_HOURS) -> list[Pair]:
    """Every forecast vintage for every target hour in the window, up to `max_horizon` ahead."""
    start, end = full_window()
    forecasts = [
        f
        for target, fs in store.by_target.items()
        if start <= target < end
        for f in fs
        if f.horizon_hours <= max_horizon
    ]
    return to_pairs(store, forecasts)


# --- statistics -------------------------------------------------------------


def quantile(values: list[float], q: float) -> float:
    """Linear-interpolated quantile (same definition as numpy's default)."""
    if not values:
        return math.nan
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def metrics(pairs: list[Pair]) -> dict:
    if not pairs:
        return {"n": 0}
    errors = [p.error for p in pairs]
    abs_errors = [abs(e) for e in errors]
    mean_actual = fmean(p.actual for p in pairs)
    mae = fmean(abs_errors)
    return {
        "n": len(pairs),
        "mae": mae,
        "rmse": math.sqrt(fmean(e * e for e in errors)),
        "bias": fmean(errors),
        "nmae": mae / mean_actual if mean_actual else None,
        "p50AbsError": quantile(abs_errors, 0.5),
        "p90AbsError": quantile(abs_errors, 0.9),
        "maxAbsError": max(abs_errors),
        "meanActual": mean_actual,
        "correlation": _correlation([p.forecast for p in pairs], [p.actual for p in pairs]),
    }


def _correlation(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    mx, my = fmean(xs), fmean(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=False))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    return cov / math.sqrt(vx * vy) if vx and vy else None


BUFFER_LEVELS = (0.5, 0.8, 0.9, 0.95)


def buffers(errors: list[float]) -> list[dict]:
    """MW to hold back from the wind forecast so actual wind covers it with the given confidence.

    If actual >= forecast - buffer in a fraction `c` of hours, buffer = quantile(error, c).
    """
    return [{"confidence": c, "bufferMw": quantile(errors, c)} for c in BUFFER_LEVELS]


def by_horizon(pairs: list[Pair], bucket_hours: int = 6) -> list[dict]:
    groups: dict[int, list[Pair]] = defaultdict(list)
    for p in pairs:
        b = min(int(p.horizon_hours // bucket_hours), MAX_HORIZON_HOURS // bucket_hours - 1)
        groups[b].append(p)
    return [
        {"fromHours": b * bucket_hours, "toHours": (b + 1) * bucket_hours, **metrics(groups[b])} for b in sorted(groups)
    ]


def by_hour_of_day(pairs: list[Pair]) -> list[dict]:
    groups: dict[int, list[Pair]] = defaultdict(list)
    for p in pairs:
        groups[p.start_time.astimezone(UK_TZ).hour].append(p)
    return [{"hour": h, **metrics(groups[h])} for h in sorted(groups)]


def histogram(errors: list[float], bin_mw: int = 500) -> list[dict]:
    counts: dict[int, int] = defaultdict(int)
    for e in errors:
        counts[math.floor(e / bin_mw)] += 1
    if not counts:
        return []
    lo, hi = min(counts), max(counts)
    return [{"fromMw": b * bin_mw, "toMw": (b + 1) * bin_mw, "count": counts.get(b, 0)} for b in range(lo, hi + 1)]


def energy_mwh(pairs: list[Pair]) -> tuple[float, float]:
    """(forecast, actual) energy over the pairs, treating each hourly value as flat for the hour."""
    return sum(p.forecast for p in pairs), sum(p.actual for p in pairs)


def band_from_other_days(per_day: dict[date, list[Pair]], day: date, lower_q=0.1, upper_q=0.9) -> tuple[float, float]:
    """Error quantiles learned from every *other* delivery day (leave-one-out, so no peeking)."""
    errors = [p.error for d, ps in per_day.items() if d != day for p in ps]
    return quantile(errors, lower_q), quantile(errors, upper_q)


def band_coverage(per_day: dict[date, list[Pair]], lower_q=0.1, upper_q=0.9) -> float | None:
    """Backtest: share of hours where actual fell inside the leave-one-out band."""
    hit = total = 0
    for day, pairs in per_day.items():
        if not pairs:
            continue
        lo_err, hi_err = band_from_other_days(per_day, day, lower_q, upper_q)
        for p in pairs:
            total += 1
            hit += p.forecast - hi_err <= p.actual <= p.forecast - lo_err
    return hit / total if total else None
