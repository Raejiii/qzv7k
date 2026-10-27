"""Static configuration for the pilot.

The analysis window is fixed by the brief: purchase decisions made in January 2026.
A day-ahead decision taken on day D-1 covers delivery day D, so decisions on
1-31 Jan cover delivery days 2 Jan - 1 Feb.
"""

from datetime import date, time
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

FIRST_DECISION_DATE = date(2026, 1, 1)
LAST_DECISION_DATE = date(2026, 1, 31)
FIRST_DELIVERY_DATE = date(2026, 1, 2)
LAST_DELIVERY_DATE = date(2026, 2, 1)

# GB day-ahead hourly auction gate closure (N2EX / EPEX) is 11:00 UK time on D-1.
DEFAULT_CUTOFF = time(11, 0)

# Forecasts beyond this horizon are ignored in the accuracy-by-horizon analysis.
MAX_HORIZON_HOURS = 48
