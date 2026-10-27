"""End-to-end checks against the bundled January 2026 snapshot."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta_lists_31_delivery_days():
    body = client.get("/api/meta").json()
    assert len(body["deliveryDates"]) == 31
    assert body["deliveryDates"][0] == "2026-01-02"
    assert body["deliveryDates"][-1] == "2026-02-01"


def test_day_ahead_has_full_day():
    body = client.get("/api/day-ahead", params={"delivery_date": "2026-01-15"}).json()
    assert len(body["forecast"]) == 24
    assert len(body["actual"]) == 48
    assert body["forecastPublishTime"] <= body["decisionTime"]


def test_every_day_has_a_decision_forecast():
    daily = client.get("/api/accuracy").json()["daily"]
    assert all(d["n"] == 24 for d in daily)


def test_day_outside_window_is_404():
    assert client.get("/api/day-ahead", params={"delivery_date": "2026-03-01"}).status_code == 404


def test_bad_cutoff_is_422():
    assert client.get("/api/accuracy", params={"cutoff": "noon"}).status_code == 422


def test_horizon_accuracy_degrades_with_lead_time():
    buckets = client.get("/api/horizon-accuracy").json()["buckets"]
    assert buckets[0]["mae"] < buckets[-1]["mae"]
