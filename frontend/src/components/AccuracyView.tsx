import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { apiUrl, useApi, type Accuracy, type HorizonAccuracy } from "../api";
import { fmtDate, fmtDayTime, fmtGwh, fmtMw, fmtPct, fmtSignedMw, kAxis } from "../format";
import { COLORS, Card, Kpi, Legend, Ready, Tip } from "./ui";

export function AccuracyView({ cutoff, onPickDay }: { cutoff: string; onPickDay: (d: string) => void }) {
  const acc = useApi<Accuracy>(apiUrl("/api/accuracy", { cutoff }));
  const hz = useApi<HorizonAccuracy>(apiUrl("/api/horizon-accuracy"));

  return (
    <Ready state={acc}>
      {(a) => (
        <>
          <p className="headline">
            Every delivery day from <strong>2 Jan to 1 Feb 2026</strong>, judged on the forecast the desk had at <strong>{a.cutoff}</strong> the day
            before. Error is forecast minus actual, so a positive number is wind that didn't turn up and had to be bought.
          </p>

          <div className="kpis">
            <Kpi label="Typical hourly error" value={fmtMw(a.overall.mae)} hint={`MAE · ${fmtPct(a.overall.nmae)} of average wind output`} />
            <Kpi label="Systematic bias" value={fmtSignedMw(a.overall.bias)} hint={a.overall.bias > 0 ? "Forecast runs high on average" : "Forecast runs low on average"} emphasis />
            <Kpi label="RMSE" value={fmtMw(a.overall.rmse)} hint={`1 in 10 hours missed by more than ${fmtMw(a.overall.p90AbsError)}`} />
            <Kpi label="Forecast/actual correlation" value={a.overall.correlation?.toFixed(2) ?? "–"} hint={`${a.overall.n} hourly pairs`} />
            <Kpi label="Range backtest" value={fmtPct(a.bandCoverage)} hint="Share of hours inside the 80% range (target 80%)" />
          </div>

          {a.overall.bias > 500 && (
            <div className="note">
              The forecast over-predicted wind in most hours this month, by {fmtMw(a.overall.bias)} on average, even a few hours ahead (see the
              horizon chart). A likely cause is curtailment: forecasts estimate what the wind could generate, but metered output falls when the grid
              tells wind farms to turn down. Don't take the raw forecast at face value. Use the buffers below, which already account for this.
            </div>
          )}

          <Card title="How much wind to hold back" sub="Subtract this from the forecast to get a volume that actual wind beat in the given share of January hours. The rest is what to buy.">
            <table className="data">
              <thead>
                <tr>
                  <th>Confidence</th>
                  <th>Hold back from forecast</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {a.buffers.map((b) => (
                  <tr key={b.confidence}>
                    <td>{fmtPct(b.confidence)}</td>
                    <td>{fmtMw(b.bufferMw)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                      Actual wind ≥ forecast − {fmtMw(b.bufferMw)} in {fmtPct(b.confidence)} of hours
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid-2">
            <Card title="Error grows with lead time" sub="Every forecast run for every January hour, grouped by how many hours ahead it was published.">
              <Ready state={hz}>{(h) => <HorizonChart h={h} />}</Ready>
            </Card>
            <Card title="Daily wind energy, forecast vs actual (GWh)" sub="Click a day to open it in the Day-ahead view.">
              <DailyChart a={a} onPickDay={onPickDay} />
            </Card>
            <Card title="Error by hour of day" sub="Mean absolute error and bias for each delivery hour (UK time).">
              <HourChart a={a} />
            </Card>
            <Card title="Error distribution" sub="Hours by size of error, in 500 MW bins. Bars right of zero are shortfalls the desk had to buy.">
              <HistogramChart a={a} />
            </Card>
          </div>

          <Card title="Forecast vs actual, every hour (actual on the vertical axis)" sub="Points below the diagonal are hours where the forecast was too high.">
            <ScatterView a={a} />
          </Card>
        </>
      )}
    </Ready>
  );
}

function HorizonChart({ h }: { h: HorizonAccuracy }) {
  const data = h.buckets.map((b) => ({ ...b, label: `${b.fromHours}–${b.toHours}h` }));
  return (
    <>
      <Legend
        items={[
          { label: "Mean absolute error", color: COLORS.actual },
          { label: "Bias", color: COLORS.forecast },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" />
          <YAxis tickFormatter={kAxis} width={44} domain={[0, "auto"]} />
          <Tooltip
            cursor={{ fill: "var(--grid)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <Tip
                  title={`${payload[0].payload.label} ahead`}
                  rows={[
                    { label: "MAE", color: COLORS.actual, value: fmtMw(payload[0].payload.mae) },
                    { label: "Bias", color: COLORS.forecast, value: fmtSignedMw(payload[0].payload.bias) },
                    { label: "Pairs", value: payload[0].payload.n },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="mae" fill={COLORS.actual} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          <Line dataKey="bias" stroke={COLORS.forecast} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

function DailyChart({ a, onPickDay }: { a: Accuracy; onPickDay: (d: string) => void }) {
  return (
    <>
      <Legend
        items={[
          { label: "Forecast at decision time", color: COLORS.forecast },
          { label: "Actual", color: COLORS.actual },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={a.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} onClick={(e) => e?.activeLabel && onPickDay(String(e.activeLabel))}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(8)} interval={2} />
          <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}`} width={44} />
          <Tooltip
            cursor={{ fill: "var(--grid)", cursor: "pointer" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Accuracy["daily"][number];
              return (
                <Tip
                  title={fmtDate(d.date)}
                  rows={[
                    { label: "Forecast", color: COLORS.forecast, value: fmtGwh(d.forecastEnergyMwh) },
                    { label: "Actual", color: COLORS.actual, value: fmtGwh(d.actualEnergyMwh) },
                    { label: "Hourly MAE", value: fmtMw(d.mae) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="forecastEnergyMwh" fill={COLORS.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} style={{ cursor: "pointer" }} />
          <Bar dataKey="actualEnergyMwh" fill={COLORS.actual} radius={[4, 4, 0, 0]} isAnimationActive={false} style={{ cursor: "pointer" }} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function HourChart({ a }: { a: Accuracy }) {
  return (
    <>
      <Legend
        items={[
          { label: "Mean absolute error", color: COLORS.actual },
          { label: "Bias", color: COLORS.forecast },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={a.byHourOfDay} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="hour" tickFormatter={(h: number) => `${String(h).padStart(2, "0")}:00`} interval={3} />
          <YAxis tickFormatter={kAxis} width={44} domain={[0, "auto"]} />
          <Tooltip
            cursor={{ fill: "var(--grid)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <Tip
                  title={`${String(payload[0].payload.hour).padStart(2, "0")}:00`}
                  rows={[
                    { label: "MAE", color: COLORS.actual, value: fmtMw(payload[0].payload.mae) },
                    { label: "Bias", color: COLORS.forecast, value: fmtSignedMw(payload[0].payload.bias) },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="mae" fill={COLORS.actual} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line dataKey="bias" stroke={COLORS.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

function HistogramChart({ a }: { a: Accuracy }) {
  const data = a.histogram;
  return (
    <ResponsiveContainer width="100%" height={286}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="fromMw" tickFormatter={kAxis} interval={1} />
        <YAxis width={44} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "var(--grid)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <Tip
                title={`Error ${fmtSignedMw(payload[0].payload.fromMw)} to ${fmtSignedMw(payload[0].payload.toMw)}`}
                rows={[{ label: "Hours", value: payload[0].payload.count }]}
              />
            ) : null
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((b) => (
            <Cell key={b.fromMw} fill={b.fromMw >= 0 ? COLORS.forecast : COLORS.actual} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScatterView({ a }: { a: Accuracy }) {
  const max = Math.max(...a.scatter.map((p) => Math.max(p.forecast, p.actual)));
  const top = Math.ceil(max / 5000) * 5000;
  const ticks = Array.from({ length: top / 5000 + 1 }, (_, i) => i * 5000);
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
        <CartesianGrid />
        <XAxis type="number" dataKey="forecast" domain={[0, top]} ticks={ticks} tickFormatter={kAxis} label={{ value: "Forecast (MW)", position: "insideBottom", offset: -8 }} />
        <YAxis type="number" dataKey="actual" domain={[0, top]} ticks={ticks} tickFormatter={kAxis} width={44} />
        <ZAxis range={[36, 36]} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: top, y: top }]} stroke={COLORS.muted} strokeDasharray="4 4" />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <Tip
                title={fmtDayTime(payload[0].payload.time)}
                rows={[
                  { label: "Forecast", value: fmtMw(payload[0].payload.forecast) },
                  { label: "Actual", value: fmtMw(payload[0].payload.actual) },
                ]}
              />
            ) : null
          }
        />
        <Scatter data={a.scatter} fill={COLORS.actual} fillOpacity={0.55} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
