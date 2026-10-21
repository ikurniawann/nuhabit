/**
 * Asesmen kebugaran gym: metrik tubuh dan benchmark HYROX. Definisi metrik
 * dipakai dasbor (label Indonesia) dan aplikasi member (label Inggris sebagai
 * kunci kamus). Murni tanpa I/O.
 */

/** Satu asesmen seperti dikirim API (/api/gym/assessments, /api/member-portal/gym/assessments). */
export interface Assessment {
  id: string;
  customer_id: string;
  member_name: string | null;
  coach_id: string | null;
  coach_name: string | null;
  assessed_on: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  resting_hr: number | null;
  run_1km_sec: number | null;
  ski_1km_sec: number | null;
  row_1km_sec: number | null;
  wall_balls_max_reps: number | null;
  sled_push_sec: number | null;
  sled_pull_sec: number | null;
  burpee_broad_jump_sec: number | null;
  notes: string;
  goals: string;
  created_by_name: string;
  /** Saat dicatat, format toISOString (UTC, milidetik) seperti rute gym lain. */
  created_at: string;
}

export type MetricKey =
  | "weight_kg"
  | "body_fat_pct"
  | "muscle_mass_kg"
  | "resting_hr"
  | "run_1km_sec"
  | "ski_1km_sec"
  | "row_1km_sec"
  | "wall_balls_max_reps"
  | "sled_push_sec"
  | "sled_pull_sec"
  | "burpee_broad_jump_sec";

/** kg dan % boleh desimal; detik ditulis m:ss; reps dan bpm bilangan bulat. */
export type MetricKind = "decimal" | "seconds" | "count";

export interface Metric {
  key: MetricKey;
  /** Label dasbor. */
  label: string;
  /** Label aplikasi member (kunci kamus ID). */
  labelEn: string;
  unit: string;
  kind: MetricKind;
  group: "body" | "hyrox";
  /** Waktu dan lemak tubuh membaik saat turun. */
  lowerIsBetter: boolean;
}

export const METRICS: Metric[] = [
  { key: "weight_kg", label: "Berat badan", labelEn: "Body weight", unit: "kg", kind: "decimal", group: "body", lowerIsBetter: false },
  { key: "body_fat_pct", label: "Lemak tubuh", labelEn: "Body fat", unit: "%", kind: "decimal", group: "body", lowerIsBetter: true },
  { key: "muscle_mass_kg", label: "Massa otot", labelEn: "Muscle mass", unit: "kg", kind: "decimal", group: "body", lowerIsBetter: false },
  { key: "resting_hr", label: "Denyut nadi istirahat", labelEn: "Resting heart rate", unit: "bpm", kind: "count", group: "body", lowerIsBetter: true },
  { key: "run_1km_sec", label: "Lari 1 km", labelEn: "1 km run", unit: "", kind: "seconds", group: "hyrox", lowerIsBetter: true },
  { key: "ski_1km_sec", label: "SkiErg 1 km", labelEn: "1 km SkiErg", unit: "", kind: "seconds", group: "hyrox", lowerIsBetter: true },
  { key: "row_1km_sec", label: "Row 1 km", labelEn: "1 km row", unit: "", kind: "seconds", group: "hyrox", lowerIsBetter: true },
  { key: "wall_balls_max_reps", label: "Wall ball maks", labelEn: "Wall balls max", unit: "reps", kind: "count", group: "hyrox", lowerIsBetter: false },
  { key: "sled_push_sec", label: "Sled push", labelEn: "Sled push", unit: "", kind: "seconds", group: "hyrox", lowerIsBetter: true },
  { key: "sled_pull_sec", label: "Sled pull", labelEn: "Sled pull", unit: "", kind: "seconds", group: "hyrox", lowerIsBetter: true },
  { key: "burpee_broad_jump_sec", label: "Burpee broad jump 80 m", labelEn: "Burpee broad jumps 80 m", unit: "", kind: "seconds", group: "hyrox", lowerIsBetter: true },
];

/** 245 → "4:05". */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Nilai metrik untuk tampilan, mis. "72,5 kg", "4:05", "60 reps"; "-" bila kosong. */
export function formatMetric(metric: Metric, value: number | null | undefined, locale = "id-ID"): string {
  if (value === null || value === undefined) return "-";
  if (metric.kind === "seconds") return formatSeconds(value);
  const text = value.toLocaleString(locale, { maximumFractionDigits: 1 });
  return metric.unit ? `${text} ${metric.unit}` : text;
}

/**
 * Isian form → angka. Detik menerima "m:ss" atau detik polos; desimal
 * menerima koma. Kosong → null; tidak terbaca → undefined.
 */
export function parseMetricInput(kind: MetricKind, raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (kind === "seconds") {
    const clock = /^(\d{1,3}):([0-5]\d)$/.exec(text);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    return /^\d+$/.test(text) ? Number(text) : undefined;
  }
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  if (kind === "count" && !Number.isInteger(n)) return undefined;
  return n;
}

/** Nilai metrik → isian form. */
export function metricInput(metric: Metric, value: number | null): string {
  if (value === null) return "";
  return metric.kind === "seconds" ? formatSeconds(value) : String(value).replace(".", ",");
}

export interface MetricPoint {
  date: string;
  value: number;
}

/** Riwayat satu metrik, tanggal terlama dulu, hanya asesmen yang mengukurnya. */
export function metricSeries(history: Assessment[], key: MetricKey): MetricPoint[] {
  return history
    .filter((a) => a[key] !== null)
    .map((a) => ({ date: a.assessed_on, value: a[key] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface Progress {
  latest: number;
  /** Selisih terbaru dikurangi pertama; null bila baru satu pengukuran. */
  change: number | null;
  /** Arah membaik menurut metrik; null bila tidak berubah atau belum ada pembanding. */
  improved: boolean | null;
}

/** Nilai terbaru dan perubahannya sejak pengukuran pertama. */
export function metricProgress(metric: Metric, series: MetricPoint[]): Progress | null {
  if (series.length === 0) return null;
  const first = series[0]!.value;
  const latest = series[series.length - 1]!.value;
  if (series.length === 1) return { latest, change: null, improved: null };
  const change = Math.round((latest - first) * 10) / 10;
  return { latest, change, improved: change === 0 ? null : change < 0 === metric.lowerIsBetter };
}

/** Selisih bertanda untuk tampilan, mis. "-0:12" atau "+1,5 kg". */
export function formatChange(metric: Metric, change: number, locale = "id-ID"): string {
  const sign = change > 0 ? "+" : change < 0 ? "-" : "±";
  const magnitude = Math.abs(change);
  return sign + formatMetric(metric, magnitude, locale);
}
