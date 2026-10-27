"""Thin client for the two Elexon BMRS datasets the product uses."""

from datetime import UTC, date, datetime

import httpx

from .config import ELEXON_BASE_URL
from .models import Actual, Forecast

TIMEOUT = httpx.Timeout(60.0)


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def fetch_wind_actuals(settlement_from: date, settlement_to: date) -> list[Actual]:
    """Half-hourly outturn wind generation (FUELHH, fuelType=WIND)."""
    resp = httpx.get(
        f"{ELEXON_BASE_URL}/datasets/FUELHH/stream",
        params={
            "settlementDateFrom": settlement_from.isoformat(),
            "settlementDateTo": settlement_to.isoformat(),
            "fuelType": "WIND",
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return [
        Actual(start_time=_parse_ts(r["startTime"]), generation=float(r["generation"]))
        for r in resp.json()
        if r.get("fuelType") == "WIND"
    ]


def fetch_wind_forecasts(publish_from: datetime, publish_to: datetime) -> list[Forecast]:
    """Hourly national wind forecasts (WINDFOR), every vintage published in the range."""
    resp = httpx.get(
        f"{ELEXON_BASE_URL}/datasets/WINDFOR/stream",
        params={
            "publishDateTimeFrom": publish_from.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "publishDateTimeTo": publish_to.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return [
        Forecast(
            publish_time=_parse_ts(r["publishTime"]),
            start_time=_parse_ts(r["startTime"]),
            generation=float(r["generation"]),
        )
        for r in resp.json()
    ]
