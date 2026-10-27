import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiUrl, useApi, type Meta, type Series } from "../api";
import { fmtDay, fmtDayTime, fmtMw, fmtPct, fmtSignedMw, kAxis } from "../format";
import { COLORS, Card, Kpi, Legend, Ready, Tip } from "./ui";

interface Row {
  t: number;
  actual?: number;
  forecast?: number;
  publishTime?: string;
}

export function ExplorerView({ meta }: { meta: Meta }) {
  const [horizon, setHorizon] = useState(24);
  const [committed, setCommitted] = useState(24);
  const state = useApi<Series>(apiUrl("/api/series", { horizon_hours: committed }));

  return (
    <>
      <div className="controls">
        <label>
          Forecast made at least
          <input
            type="range"
            min={0}
            max={meta.maxHorizonHours}
            step={1}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            onPointerUp={() => setCommitted(horizon)}
            onKeyUp={() => setCommitted(horizon)}
          />
          <strong style={{ color: "var(--text-primary)", minWidth: 32 }}>{horizon}h</strong>
          ahead
        </label>
      </div>
      <Ready state={state}>{(s) => <ExplorerBody s={s} />}</Ready>
    </>
  );
}

function ExplorerBody({ s }: { s: Series }) {
  const rows = useMemo(() => {
    const m = new Map<number, Row>();
    const at = (time: string) => {
      const t = Date.parse(time);
      if (!m.has(t)) m.set(t, { t });
      return m.get(t)!;
    };
    s.actual.forEach((p) => (at(p.time).actual = p.mw));
    s.forecast.forEach((p) => Object.assign(at(p.time), { forecast: p.mw, publishTime: p.publishTime }));
    return [...m.values()].sort((a, b) => a.t - b.t);
  }, [s]);

  return (
    <>
      <p className="headline">
        For every hour from 2 Jan to 1 Feb, the latest forecast that existed <strong>{s.horizonHours} hours or more</strong> before that hour. Move
        the slider to see how much better forecasts get as delivery gets closer.
      </p>
      <div className="kpis">
        <Kpi label="MAE" value={fmtMw(s.metrics.mae)} hint={`${fmtPct(s.metrics.nmae)} of average output`} />
        <Kpi label="Bias" value={fmtSignedMw(s.metrics.bias)} />
        <Kpi label="RMSE" value={fmtMw(s.metrics.rmse)} />
        <Kpi label="Worst hour" value={fmtMw(s.metrics.maxAbsError)} />
      </div>
      <Card title="Wind generation across the window (MW)">
        <Legend
          items={[
            { label: "Actual (half-hourly)", color: COLORS.actual },
            { label: `Forecast ≥ ${s.horizonHours}h ahead`, color: COLORS.forecast },
          ]}
        />
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtDay} tickCount={10} />
            <YAxis tickFormatter={kAxis} width={44} domain={[0, "auto"]} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Row;
                return (
                  <Tip
                    title={fmtDayTime(r.t)}
                    rows={[
                      ...(r.actual != null ? [{ label: "Actual", color: COLORS.actual, value: fmtMw(r.actual) }] : []),
                      ...(r.forecast != null ? [{ label: "Forecast", color: COLORS.forecast, value: fmtMw(r.forecast) }] : []),
                      ...(r.publishTime ? [{ label: "Published", value: fmtDayTime(r.publishTime) }] : []),
                    ]}
                  />
                );
              }}
            />
            <Line dataKey="actual" stroke={COLORS.actual} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="forecast" stroke={COLORS.forecast} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}
