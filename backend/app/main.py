"""HTTP API. Serves the built React app too when FRONTEND_DIST points at it."""

import os
from datetime import date, datetime, time
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analysis as an
from .config import DEFAULT_CUTOFF, FIRST_DECISION_DATE, LAST_DECISION_DATE, MAX_HORIZON_HOURS, UK_TZ
from .store import delivery_dates, get_store

app = FastAPI(title="Wind Forecast Desk API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_cutoff(value: str) -> time:
    try:
        return time.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"cutoff must be HH:MM, got {value!r}") from None


def _check_day(day: date) -> None:
    if day not in delivery_dates():
        raise HTTPException(404, f"{day} is outside the January 2026 decision window")


@lru_cache(maxsize=32)
def _day_ahead_cache(cutoff: time):
    return an.day_ahead_pairs(get_store(), cutoff)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/meta")
def meta():
    store = get_store()
    return {
        "firstDecisionDate": FIRST_DECISION_DATE.isoformat(),
        "lastDecisionDate": LAST_DECISION_DATE.isoformat(),
        "deliveryDates": [d.isoformat() for d in delivery_dates()],
        "defaultCutoff": DEFAULT_CUTOFF.strftime("%H:%M"),
        "maxHorizonHours": MAX_HORIZON_HOURS,
        "timezone": str(UK_TZ),
        "forecastRuns": len(store.publish_times),
        "forecastRunTimesUk": sorted({p.astimezone(UK_TZ).strftime("%H:%M") for p in store.publish_times}),
    }


@app.get("/api/day-ahead")
def day_ahead(delivery_date: date, cutoff: str = DEFAULT_CUTOFF.strftime("%H:%M")):
    """Everything the desk needs for one delivery day's purchase decision."""
    _check_day(delivery_date)
    cut = _parse_cutoff(cutoff)
    store = get_store()
    vintage, forecasts = an.forecast_at_decision(store, delivery_date, cut)
    per_day = _day_ahead_cache(cut)
    pairs = per_day[delivery_date]
    lo_err, hi_err = an.band_from_other_days(per_day, delivery_date)
    mid_err, _ = an.band_from_other_days(per_day, delivery_date, 0.5, 0.5)
    start, end = an.delivery_window(delivery_date)
    latest = an.latest_before_delivery(store, delivery_date)
    forecast_mwh, actual_mwh = an.energy_mwh(pairs)

    return {
        "deliveryDate": delivery_date.isoformat(),
        "decisionTime": _iso(an.decision_moment(delivery_date, cut)),
        "forecastPublishTime": _iso(vintage) if vintage else None,
        "band": {
            "lowerQuantile": 0.1,
            "upperQuantile": 0.9,
            "lowerErrorMw": lo_err,
            "upperErrorMw": hi_err,
            "medianErrorMw": mid_err,
        },
        "forecast": [{"time": _iso(f.start_time), "mw": f.generation} for f in forecasts],
        "latestForecast": [
            {"time": _iso(f.start_time), "mw": f.generation, "publishTime": _iso(f.publish_time)} for f in latest
        ],
        "actual": [{"time": _iso(a.start_time), "mw": a.generation} for a in store.actuals_between(start, end)],
        "summary": {
            "forecastEnergyMwh": forecast_mwh,
            "actualEnergyMwh": actual_mwh,
            "minForecastMw": min((f.generation for f in forecasts), default=None),
            "maxForecastMw": max((f.generation for f in forecasts), default=None),
            **an.metrics(pairs),
        },
    }


@app.get("/api/accuracy")
def accuracy(cutoff: str = DEFAULT_CUTOFF.strftime("%H:%M")):
    """How good was the decision-time forecast across the whole January window?"""
    cut = _parse_cutoff(cutoff)
    per_day = _day_ahead_cache(cut)
    pairs = [p for ps in per_day.values() for p in ps]
    errors = [p.error for p in pairs]
    daily = []
    for day, ps in per_day.items():
        f_mwh, a_mwh = an.energy_mwh(ps)
        daily.append({"date": day.isoformat(), "forecastEnergyMwh": f_mwh, "actualEnergyMwh": a_mwh, **an.metrics(ps)})

    return {
        "cutoff": cut.strftime("%H:%M"),
        "overall": an.metrics(pairs),
        "buffers": an.buffers(errors),
        "bandCoverage": an.band_coverage(per_day),
        "byHourOfDay": an.by_hour_of_day(pairs),
        "histogram": an.histogram(errors),
        "daily": daily,
        "scatter": [{"forecast": p.forecast, "actual": p.actual, "time": _iso(p.start_time)} for p in pairs],
    }


@app.get("/api/horizon-accuracy")
def horizon_accuracy(bucket_hours: int = Query(6, ge=1, le=24)):
    """Accuracy of every forecast vintage, grouped by how far ahead it was made."""
    return {"buckets": an.by_horizon(an.all_window_pairs(get_store()), bucket_hours)}


@app.get("/api/series")
def series(horizon_hours: float = Query(24, ge=0, le=MAX_HORIZON_HOURS)):
    """Whole-window actual vs the latest forecast made at least `horizon_hours` before each hour."""
    store = get_store()
    pairs = an.horizon_pairs(store, horizon_hours)
    start, end = an.full_window()
    return {
        "horizonHours": horizon_hours,
        "actual": [{"time": _iso(a.start_time), "mw": a.generation} for a in store.actuals_between(start, end)],
        "forecast": [
            {"time": _iso(p.start_time), "mw": p.forecast, "publishTime": _iso(p.publish_time)} for p in pairs
        ],
        "metrics": an.metrics(pairs),
    }


# --- static frontend (Docker / single-container deploys) --------------------

_dist = os.environ.get("FRONTEND_DIST")
if _dist and Path(_dist).is_dir():
    dist = Path(_dist)
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = dist / path
        return FileResponse(file if path and file.is_file() else dist / "index.html")
