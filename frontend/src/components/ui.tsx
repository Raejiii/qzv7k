import type { ReactNode } from "react";
import type { Loadable } from "../api";

export function Kpi({ label, value, hint, emphasis }: { label: string; value: ReactNode; hint?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={`kpi${emphasis ? " emphasis" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Card({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  kind?: "line" | "dashed" | "area";
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} style={{ color: i.color }}>
          <i className={`swatch ${i.kind ?? ""}`} style={{ background: i.kind === "dashed" ? undefined : i.color }} />
          <span style={{ color: "var(--text-secondary)" }}>{i.label}</span>
        </span>
      ))}
    </div>
  );
}

export function Tip({ title, rows }: { title: ReactNode; rows: { label: string; color?: string; value: ReactNode }[] }) {
  return (
    <div className="tooltip">
      <div className="t">{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span className="k">
            {r.color && <i className="swatch" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Render children once data is ready; a status line otherwise. */
export function Ready<T>({ state, children }: { state: Loadable<T>; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <div className="status">Loading…</div>;
  if (state.status === "error") return <div className="status">Could not load data: {state.message}</div>;
  return <>{children(state.data)}</>;
}

export const COLORS = {
  actual: "var(--series-actual)",
  forecast: "var(--series-forecast)",
  latest: "var(--series-latest)",
  band: "var(--band)",
  muted: "var(--text-muted)",
};
