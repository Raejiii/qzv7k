"""Re-download January 2026 wind data from Elexon into backend/data/snapshot.json.

Run from the backend directory:  python -m scripts.refresh_snapshot
"""

from app.store import SNAPSHOT_PATH, fetch_live, write_snapshot


def main() -> None:
    actuals, forecasts = fetch_live()
    write_snapshot(actuals, forecasts)
    print(f"Wrote {len(actuals)} actuals and {len(forecasts)} forecasts to {SNAPSHOT_PATH}")


if __name__ == "__main__":
    main()
