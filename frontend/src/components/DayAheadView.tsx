import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiUrl, useApi, type DayAhead, type Meta } from "../api";
import { fmtDate, fmtDayTime, fmtGwh, fmtMw, fmtPct, fmtSignedMw, fmtTime, kAxis } from "../format";
import { COLORS, Card, Kpi, Legend, Ready, Tip } from "./ui";

interface Row {
  t: number;
  actual?: number;
  forecast?: number;
  latest?: number;
  band?: [number, number];
}

function buildRows(d: DayAhead): Row[] {
  const rows = new Map<number, Row>();
  const at = (time: string) => {
    const t = Date.parse(time);
    if (!rows.has(t)) rows.set(t, { t });
    return rows.get(t)!;
  };
  for (const p of d.actual) at(p.time).actual = p.mw;
  for (const p of d.latestForecast) at(p.time).latest = p.mw;
  for (const p of d.forecast) {
    const r = at(p.time);
    r.forecast = p.mw;
    r.band = [Math.max(0, p.mw - d.band.upperErrorMw), Math.max(0, p.mw - d.band.lowerErrorMw)];
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

export function DayAheadView({ meta, cutoff, day, onDayChange }: { meta: Meta; cutoff: string; day: string; onDayChange: (d: string) => void }) {
  const state = useApi<DayAhead>(apiUrl("/api/day-ahead", { delivery_date: day, cutoff }));
  const [hindsight, setHindsight] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const idx = meta.deliveryDates.indexOf(day);

  return (
    <>
      <div className="controls">
        <label>
          Delivery day
          <select value={day} onChange={(e) => onDayChange(e.target.value)}>
            {meta.deliveryDates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={idx <= 0} onClick={() => onDayChange(meta.deliveryDates[idx - 1])} aria-label="Previous day">
          ←
        </button>
        <button className="btn" disabled={idx >= meta.deliveryDates.length - 1} onClick={() => onDayChange(meta.deliveryDates[idx + 1])} aria-label="Next day">
          →
        </button>
        <label>
          <input type="checkbox" checked={hindsight} onChange={(e) => setHindsight(e.target.checked)} />
          Show what actually happened
        </label>
      </div>
      <Ready state={state}>{(d) => <DayAheadBody d={d} hindsight={hindsight} showTable={showTable} setShowTable={setShowTable} />}</Ready>
    </>
  );
}

function DayAheadBody({ d, hindsight, showTable, setShowTable }: { d: DayAhead; hindsight: boolean; showTable: boolean; setShowTable: (v: boolean) => void }) {
  const rows = useMemo(() => buildRows(d), [d]);
  const ticks = rows.filter((r) => new Date(r.t).getUTCMinutes() === 0 && new Date(r.t).getUTCHours() % 3 === 0).map((r) => r.t);
  const s = d.summary;
  const firmMwh = d.forecast.reduce((acc, p) => acc + Math.max(0, p.mw - d.band.upperErrorMw), 0);
  const energyErr = s.actualEnergyMwh ? s.forecastEnergyMwh / s.actualEnergyMwh - 1 : null;

  if (!d.forecastPublishTime) {
    return <div className="note">No forecast had been published by the decision cutoff ({fmtDayTime(d.decisionTime)}). Try a later cutoff.</div>;
  }

  return (
    <>
      <p className="headline">
        Buying for <strong>{fmtDate(d.deliveryDate)}</strong> at <strong>{fmtDayTime(d.decisionTime)}</strong>. The latest wind forecast available
        then was the <strong>{fmtTime(d.forecastPublishTime)}</strong> run ({fmtDayTime(d.forecastPublishTime)}).
      </p>

      <div className="kpis">
        <Kpi label="Forecast wind energy" value={fmtGwh(s.forecastEnergyMwh)} hint={`Hourly range ${fmtMw(s.minForecastMw)} – ${fmtMw(s.maxForecastMw)}`} />
        <Kpi
          emphasis
          label="Wind you can count on"
          value={fmtGwh(firmMwh)}
          hint={`90% of January hours had actual wind above forecast − ${fmtMw(d.band.upperErrorMw)}. Buy the gap.`}
        />
        {hindsight && (
          <>
            <Kpi label="Actual wind energy" value={fmtGwh(s.actualEnergyMwh)} hint={energyErr == null ? undefined : `Forecast was ${fmtPct(Math.abs(energyErr), 1)} ${energyErr > 0 ? "too high" : "too low"}`} />
            <Kpi label="Hourly error (MAE)" value={fmtMw(s.mae)} hint={`Bias ${fmtSignedMw(s.bias)} · worst hour ${fmtMw(s.maxAbsError)}`} />
          </>
        )}
      </div>

      <Card
        title="Wind generation, GB national (MW)"
        sub="The shaded band is where actual wind landed 80% of the time on other January days, given this forecast. Learned leave-one-day-out, so the day shown is never used to build its own band."
      >
        <Legend
          items={[
            { label: "Forecast at decision time", color: COLORS.forecast },
            { label: "80% range (P10–P90)", color: COLORS.band, kind: "area" },
            ...(hindsight
              ? [
                  { label: "Actual (half-hourly)", color: COLORS.actual },
                  { label: "Latest forecast before each hour", color: COLORS.latest, kind: "dashed" as const },
                ]
              : []),
          ]}
        />
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={ticks} tickFormatter={fmtTime} />
            <YAxis tickFormatter={kAxis} width={44} domain={[0, "auto"]} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Row;
                return (
                  <Tip
                    title={fmtTime(r.t)}
                    rows={[
                      ...(r.forecast != null ? [{ label: "Forecast", color: COLORS.forecast, value: fmtMw(r.forecast) }] : []),
                      ...(r.band ? [{ label: "80% range", value: `${fmtMw(r.band[0])} – ${fmtMw(r.band[1])}` }] : []),
                      ...(hindsight && r.actual != null ? [{ label: "Actual", color: COLORS.actual, value: fmtMw(r.actual) }] : []),
                      ...(hindsight && r.latest != null ? [{ label: "Latest forecast", color: COLORS.latest, value: fmtMw(r.latest) }] : []),
                    ]}
                  />
                );
              }}
            />
            <Area dataKey="band" stroke="none" fill={COLORS.band} connectNulls isAnimationActive={false} />
            <Line dataKey="forecast" stroke={COLORS.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            {hindsight && <Line dataKey="latest" stroke={COLORS.latest} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />}
            {hindsight && <Line dataKey="actual" stroke={COLORS.actual} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
        <div className="toolbar">
          <label>
            <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} /> Show hourly table
          </label>
        </div>
        {showTable && (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Hour</th>
                  <th>Forecast</th>
                  <th>Count-on (P90)</th>
                  <th>Upper (P10)</th>
                  {hindsight && <th>Actual</th>}
                  {hindsight && <th>Error</th>}
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.forecast != null)
                  .map((r) => (
                    <tr key={r.t}>
                      <td>{fmtTime(r.t)}</td>
                      <td>{fmtMw(r.forecast)}</td>
                      <td>{fmtMw(r.band?.[0])}</td>
                      <td>{fmtMw(r.band?.[1])}</td>
                      {hindsight && <td>{fmtMw(r.actual)}</td>}
                      {hindsight && <td>{r.actual != null ? fmtSignedMw(r.forecast! - r.actual) : "–"}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
