import { useEffect, useState } from "react";
import { apiUrl, useApi, type Meta } from "./api";
import { AccuracyView } from "./components/AccuracyView";
import { DayAheadView } from "./components/DayAheadView";
import { ExplorerView } from "./components/ExplorerView";
import { Ready } from "./components/ui";

type Tab = "day-ahead" | "accuracy" | "explorer";

const TABS: { id: Tab; label: string }[] = [
  { id: "day-ahead", label: "Day-ahead decision" },
  { id: "accuracy", label: "Forecast accuracy" },
  { id: "explorer", label: "Horizon explorer" },
];

// Tab and day live in the URL hash so a view can be shared or bookmarked.
function readHash(): { tab: Tab; day?: string; cutoff?: string } {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const tab = TABS.some((t) => t.id === p.get("tab")) ? (p.get("tab") as Tab) : "day-ahead";
  return { tab, day: p.get("day") ?? undefined, cutoff: p.get("cutoff") ?? undefined };
}

export default function App() {
  const meta = useApi<Meta>(apiUrl("/api/meta"));
  const initial = readHash();
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [day, setDay] = useState<string | undefined>(initial.day);
  const [cutoff, setCutoff] = useState<string | undefined>(initial.cutoff);

  useEffect(() => {
    if (meta.status !== "ready") return;
    if (!day || !meta.data.deliveryDates.includes(day)) setDay(meta.data.deliveryDates[13]);
    if (!cutoff) setCutoff(meta.data.defaultCutoff);
  }, [meta, day, cutoff]);

  useEffect(() => {
    const p = new URLSearchParams({ tab, ...(day && { day }), ...(cutoff && { cutoff }) });
    window.history.replaceState(null, "", `#${p}`);
  }, [tab, day, cutoff]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Wind Forecast Desk</h1>
          <p>GB national wind forecasts and their accuracy, for day-ahead power buying decisions made in January 2026.</p>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <Ready state={meta}>
        {(m) =>
          day && cutoff ? (
            <>
              {tab !== "explorer" && (
                <div className="controls">
                  <label>
                    Decision cutoff (UK time, day before delivery)
                    <input type="time" step={900} value={cutoff} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
                  </label>
                  <span>Forecast runs publish at {m.forecastRunTimesUk.filter((t) => t !== "12:25").join(", ")}</span>
                </div>
              )}
              {tab === "day-ahead" && <DayAheadView meta={m} cutoff={cutoff} day={day} onDayChange={setDay} />}
              {tab === "accuracy" && (
                <AccuracyView
                  cutoff={cutoff}
                  onPickDay={(d) => {
                    setDay(d);
                    setTab("day-ahead");
                    window.scrollTo({ top: 0 });
                  }}
                />
              )}
              {tab === "explorer" && <ExplorerView meta={m} />}
            </>
          ) : null
        }
      </Ready>

      <footer>
        Data: Elexon BMRS. Actuals are FUELHH (fuelType WIND, half-hourly); forecasts are WINDFOR (hourly, about eight runs a day). Forecasts are
        compared with the actual at the same start time. Default cutoff 11:00 is the GB day-ahead auction gate closure.
      </footer>
    </div>
  );
}
