# Wind Forecast Desk

A web app for a UK utility's day-ahead power buying desk. It shows the **latest GB wind generation forecast available at decision time** and **how accurate those forecasts have been**, so buyers can decide how much power to procure beyond what wind will supply.

Scope, per the brief: national wind actuals and forecasts from Elexon BMRS only, for purchase decisions made in **January 2026** (delivery days 2 Jan to 1 Feb 2026).

**Live app:** _<add your Vercel / Heroku URL here>_

---

## What the app does

| View | Question it answers |
|---|---|
| **Day-ahead decision** | For delivery day D, what did the newest forecast say at the decision cutoff on D−1? How much of that wind can we count on (P90)? In hindsight, what actually happened? |
| **Forecast accuracy** | Across the whole window: MAE, RMSE, bias, error by lead time and by hour of day, the error distribution, and a **buffer table** (MW to hold back from the forecast for 50/80/90/95% confidence). |
| **Horizon explorer** | For every hour in the window, the latest forecast made at least *H* hours earlier (slider 0–48h), compared with the actuals. |

The **decision cutoff** is configurable and defaults to **11:00 UK time**, the gate closure of the GB day-ahead hourly auction. The forecast used is the most recent WINDFOR run published at or before that moment.

### Key findings (Jan 2026, 11:00 cutoff)
- Typical hourly error (MAE) is about **2.0 GW**, around 18% of average wind output. Forecast/actual correlation is 0.93.
- The forecast runs **systematically high by about 1.7 GW**, even 0–6h ahead. This points to a structural gap (most likely wind curtailment, or a difference in metering scope between WINDFOR and FUELHH), not just weather error.
- Error grows steadily with lead time (MAE about 1.65 GW at 0–6h, about 2.3 GW at 42–48h).
- Holding back about **4.2 GW** from the forecast would have covered actual wind in 90% of hours. The leave-one-day-out 80% band held 78% of hours in backtest.

## Data and method

| Dataset | Endpoint | Use |
|---|---|---|
| FUELHH | `/datasets/FUELHH/stream?fuelType=WIND` | Actual wind generation, half-hourly (`startTime`, `generation`) |
| WINDFOR | `/datasets/WINDFOR/stream` | Wind forecasts, hourly, about 8 runs a day (`publishTime`, `startTime`, `generation`) |

- **Error = forecast − actual.** A positive error is a shortfall that the desk has to buy.
- Forecasts are matched to the actual with the same `startTime` (hourly points).
- Forecast rows published after their own target time are dropped.
- Delivery days are UK-local days (`Europe/London`), so 23- and 25-hour clock-change days are handled.
- The uncertainty band and "wind you can count on" use **error quantiles from the other days only** (leave-one-out), so a day never informs its own band.
- January 2026 is history, so the raw data is shipped as a snapshot (`backend/data/snapshot.json`, about 1 MB). The app then starts instantly and doesn't depend on Elexon being up. Run `python -m scripts.refresh_snapshot` to re-download it. If the snapshot is missing, the backend fetches live from Elexon.

## Repository layout

```
.
├── backend/                  Python 3.12 · FastAPI
│   ├── app/
│   │   ├── config.py         Window dates, default cutoff, constants
│   │   ├── models.py         Actual / Forecast / Pair dataclasses (error sign convention lives here)
│   │   ├── elexon.py         HTTP client for FUELHH and WINDFOR
│   │   ├── store.py          Loads the snapshot (or Elexon) and indexes forecasts by run and by target time
│   │   ├── analysis.py       Forecast selection at a cutoff/horizon and all accuracy statistics
│   │   └── main.py           API routes; also serves the built frontend when FRONTEND_DIST is set
│   ├── data/snapshot.json    January 2026 actuals and forecasts from Elexon
│   ├── scripts/refresh_snapshot.py
│   ├── tests/                pytest: unit tests for analysis, API tests against the snapshot
│   ├── requirements.txt / requirements-dev.txt
│   └── pyproject.toml        pytest and ruff config
├── frontend/                 React 18 · TypeScript · Vite · Recharts
│   └── src/
│       ├── api.ts            Typed API client and useApi hook
│       ├── format.ts         UK-time and MW/GWh formatting
│       ├── App.tsx           Tabs, shared cutoff control, URL-hash state
│       └── components/       DayAheadView, AccuracyView, ExplorerView, shared UI pieces
├── api/index.py              Vercel serverless entrypoint (wraps the FastAPI app)
├── vercel.json               Vercel build: static frontend + Python function for /api
├── Dockerfile                Multi-stage: build React, serve UI and API from one uvicorn container
├── docker-compose.yml        `docker compose up` → http://localhost:8000
├── heroku.yml                Heroku container deploy
├── requirements.txt          Copy of backend deps for Vercel's Python runtime
└── .github/workflows/ci.yml  Lint, tests, frontend build, Docker build
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/meta` | Window dates, default cutoff, forecast run times |
| `GET /api/day-ahead?delivery_date=2026-01-15&cutoff=11:00` | Decision-time forecast, band, actuals, latest-before-delivery forecast, day summary |
| `GET /api/accuracy?cutoff=11:00` | Window-wide metrics, buffers, by-hour, histogram, daily, scatter |
| `GET /api/horizon-accuracy?bucket_hours=6` | Metrics for every forecast run, grouped by lead time |
| `GET /api/series?horizon_hours=24` | Whole-window actual vs forecast at a fixed minimum horizon |
| `GET /api/health` | Liveness |

Interactive docs: `/docs` (FastAPI Swagger UI).

## Running it

### Docker (recommended)
```bash
docker compose up --build
# open http://localhost:8000
```

### Local development
```bash
# backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api to :8000
```

### Tests and lint
```bash
cd backend && pytest -q && ruff check . && ruff format --check .
cd frontend && npm run build   # includes tsc type-check
```

## Deployment

**Vercel:** import the repo; `vercel.json` builds the frontend and deploys `api/index.py` as a Python function. No environment variables are needed.

**Heroku (container):**
```bash
heroku create --stack container
git push heroku main
```

## Possible next steps
- Live mode: poll Elexon for the newest WINDFOR run instead of the January snapshot.
- Condition the uncertainty band on forecast level and lead time (errors are larger at high wind).
- A bias-corrected forecast, plus a longer history to separate curtailment from forecast error.
- Add solar and demand forecasts to show the net procurement requirement directly.

## Use of AI tools
This project was built with the help of an AI coding assistant (Claude Code, by Anthropic). It was used to scaffold the backend and frontend, write tests and documentation, and draft the demo script. I reviewed the design decisions, analysis method and results.
