// Typed client for the FastAPI backend. Field names mirror backend/app/main.py.

import { useEffect, useState } from "react";

export interface Metrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  nmae: number | null;
  p50AbsError: number;
  p90AbsError: number;
  maxAbsError: number;
  meanActual: number;
  correlation: number | null;
}

export interface Point {
  time: string;
  mw: number;
  publishTime?: string;
}

export interface Meta {
  firstDecisionDate: string;
  lastDecisionDate: string;
  deliveryDates: string[];
  defaultCutoff: string;
  maxHorizonHours: number;
  forecastRunTimesUk: string[];
}

export interface DayAhead {
  deliveryDate: string;
  decisionTime: string;
  forecastPublishTime: string | null;
  band: { lowerQuantile: number; upperQuantile: number; lowerErrorMw: number; upperErrorMw: number; medianErrorMw: number };
  forecast: Point[];
  latestForecast: Point[];
  actual: Point[];
  summary: Metrics & { forecastEnergyMwh: number; actualEnergyMwh: number; minForecastMw: number | null; maxForecastMw: number | null };
}

export interface Accuracy {
  cutoff: string;
  overall: Metrics;
  buffers: { confidence: number; bufferMw: number }[];
  bandCoverage: number | null;
  byHourOfDay: (Metrics & { hour: number })[];
  histogram: { fromMw: number; toMw: number; count: number }[];
  daily: (Metrics & { date: string; forecastEnergyMwh: number; actualEnergyMwh: number })[];
  scatter: { forecast: number; actual: number; time: string }[];
}

export interface HorizonAccuracy {
  buckets: (Metrics & { fromHours: number; toHours: number })[];
}

export interface Series {
  horizonHours: number;
  actual: Point[];
  forecast: Point[];
  metrics: Metrics;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function apiUrl(path: string, params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${API_BASE}${path}${qs.size ? `?${qs}` : ""}`;
}

export type Loadable<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Fetch JSON whenever the URL changes; stale responses are discarded. */
export function useApi<T>(url: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then((data) => setState({ status: "ready", data }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: e.message });
      });
    return () => ctrl.abort();
  }, [url]);
  return state;
}
