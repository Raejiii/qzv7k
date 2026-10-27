// Display helpers. All times are shown in UK local time, which is what the desk trades in.

const TZ = "Europe/London";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const dayTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const fmtTime = (t: string | number) => timeFmt.format(new Date(t));
export const fmtDay = (t: string | number) => dayFmt.format(new Date(t));
export const fmtDayTime = (t: string | number) => dayTimeFmt.format(new Date(t));

/** A delivery date string (YYYY-MM-DD) as a weekday label, without timezone drift. */
export const fmtDate = (d: string) => fmtDay(`${d}T12:00:00Z`);

export const fmtMw = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "–" : `${Math.round(v).toLocaleString("en-GB")} MW`;

export const fmtSignedMw = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMw(Math.abs(v))}`;

export const fmtGwh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${(mwh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GWh`;

export const fmtPct = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : `${(v * 100).toFixed(digits)}%`;

export const kAxis = (v: number) => `${(v / 1000).toLocaleString("en-GB")}k`;
