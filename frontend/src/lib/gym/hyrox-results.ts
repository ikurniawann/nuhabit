/**
 * HYROX result splits, shared by the member app and the dashboard: the 8
 * stations in race order, result divisions and age groups, split keys,
 * mm:ss parsing and the "paste a results list" reader. Mirrors
 * backend/internal/modules/gymtraining/domain/results.go.
 */

export const SPLIT_COUNT = 8;

export const HYROX_STATIONS = [
  { name: "SkiErg", volume: "1000 m" },
  { name: "Sled Push", volume: "50 m" },
  { name: "Sled Pull", volume: "50 m" },
  { name: "Burpee Broad Jumps", volume: "80 m" },
  { name: "Rowing", volume: "1000 m" },
  { name: "Farmers Carry", volume: "200 m" },
  { name: "Sandbag Lunges", volume: "100 m" },
  { name: "Wall Balls", volume: "100 reps" },
] as const;

export const RESULT_DIVISIONS = [
  "MEN_OPEN",
  "MEN_PRO",
  "WOMEN_OPEN",
  "WOMEN_PRO",
  "MEN_DOUBLES",
  "WOMEN_DOUBLES",
  "MIXED_DOUBLES",
  "MEN_RELAY",
  "WOMEN_RELAY",
  "MIXED_RELAY",
] as const;
export type ResultDivision = (typeof RESULT_DIVISIONS)[number];

export const RESULT_DIVISION_LABELS: Record<ResultDivision, string> = {
  MEN_OPEN: "Men Open",
  MEN_PRO: "Men Pro",
  WOMEN_OPEN: "Women Open",
  WOMEN_PRO: "Women Pro",
  MEN_DOUBLES: "Men Doubles",
  WOMEN_DOUBLES: "Women Doubles",
  MIXED_DOUBLES: "Mixed Doubles",
  MEN_RELAY: "Men Relay",
  WOMEN_RELAY: "Women Relay",
  MIXED_RELAY: "Mixed Relay",
};

export const AGE_GROUPS = [
  "16-24",
  "25-29",
  "30-34",
  "35-39",
  "40-44",
  "45-49",
  "50-54",
  "55-59",
  "60-64",
  "65-69",
  "70+",
] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export type ResultSource = "race" | "simulation";

/** A split is empty (null) when the member did not enter it. */
export type SplitList = (number | null)[];

export interface HyroxResult {
  id: string;
  source: ResultSource;
  race_event_id: string | null;
  race_name: string | null;
  workout_session_id: string | null;
  division: ResultDivision;
  age_group: AgeGroup | null;
  run_sec: SplitList;
  station_sec: SplitList;
  roxzone_sec: number | null;
  official_total_sec: number | null;
  splits_total_sec: number | null;
  total_sec: number;
  total_mismatch: boolean;
  raced_at: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
}

export interface SplitCompare {
  /** run1..run8, station1..station8, total */
  key: string;
  sec: number | null;
  previous_best_sec: number | null;
  gym_average_sec: number | null;
  is_pr: boolean;
}

export interface LeaderboardRow {
  rank: number;
  result_id: string;
  /** Staff only. */
  customer_id?: string;
  name: string;
  is_me: boolean;
  division: ResultDivision;
  age_group: AgeGroup | null;
  source: ResultSource;
  race_name: string | null;
  value_sec: number;
  total_sec: number;
  raced_at: string;
  verified: boolean;
}

export interface LeaderboardView {
  rows: LeaderboardRow[];
  my_rank: number | null;
  /** The viewer turned leaderboards off (they still see their own row). */
  hidden: boolean;
  years: number[];
}

export interface LeaderboardQuery {
  raceId?: string;
  source?: ResultSource;
  division?: ResultDivision;
  ageGroup?: AgeGroup;
  year?: number;
  includeUnverified?: boolean;
  /** 1..8 ranks one station instead of the total. */
  station?: number;
}

export function leaderboardParams(q: LeaderboardQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (q.raceId) params.set("race_id", q.raceId);
  if (q.source) params.set("source", q.source);
  if (q.division) params.set("division", q.division);
  if (q.ageGroup) params.set("age_group", q.ageGroup);
  if (q.year) params.set("year", String(q.year));
  if (q.includeUnverified) params.set("include_unverified", "true");
  if (q.station) params.set("station", String(q.station));
  return params;
}

/** "run3" → "Run 3", "station1" → "SkiErg", "total" → "Total". English, for t(). */
export function splitLabel(key: string): string {
  const run = key.match(/^run(\d)$/);
  if (run) return `Run ${run[1]}`;
  const station = key.match(/^station(\d)$/);
  if (station) return HYROX_STATIONS[Number(station[1]) - 1]?.name ?? key;
  return key === "total" ? "Total" : key;
}

/**
 * "4:12" or "1:04:12" → seconds; null for anything else, zero included.
 * Digits only work too, for a phone's number pad: "412" is 4:12 and
 * "10412" is 1:04:12.
 */
export function parseSplit(text: string): number | null {
  const trimmed = text.trim();
  const typed = /^\d{3,6}$/.test(trimmed)
    ? trimmed.replace(/^(\d{0,2}?)(\d{1,2})(\d{2})$/, (_, h: string, m: string, s: string) => (h ? `${h}:${m}:${s}` : `${m}:${s}`))
    : trimmed;
  const match = typed.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const [, h = "0", m, s] = match;
  if (Number(s) >= 60 || (match[1] !== undefined && Number(m) >= 60)) return null;
  const sec = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return sec > 0 ? sec : null;
}

/** Seconds → "4:12" (or "1:04:12"); empty for null. */
export function formatSplit(sec: number | null): string {
  if (sec === null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Sum of 8 runs, 8 stations and Roxzone; null until all 16 are entered. */
export function splitsTotal(runs: SplitList, stations: SplitList, roxzone: number | null): number | null {
  const all = [...runs, ...stations];
  if (all.length !== 2 * SPLIT_COUNT || all.some((v) => v === null)) return null;
  return all.reduce<number>((sum, v) => sum + (v ?? 0), 0) + (roxzone ?? 0);
}

/** Tolerance before an official total counts as different from the splits. */
export const TOTAL_TOLERANCE_SEC = 5;

export interface PastedSplits {
  runs: SplitList;
  stations: SplitList;
  roxzone: number | null;
  total: number | null;
}

const STATION_WORDS = [/ski/i, /push/i, /pull/i, /burpee|bbj/i, /row/i, /farmer|carry/i, /lunge/i, /wall/i];

/**
 * Reads a results list pasted from the HYROX results site or a note. Lines
 * with a label ("Running 3", "SkiErg", "Roxzone", "Total") land on that
 * split. Without labels, the times are taken in race order: run, station,
 * run, station, …, then Roxzone and the total when present.
 */
export function parseResultsPaste(text: string): PastedSplits {
  const out: PastedSplits = {
    runs: Array(SPLIT_COUNT).fill(null),
    stations: Array(SPLIT_COUNT).fill(null),
    roxzone: null,
    total: null,
  };
  const unlabeled: number[] = [];
  let labeled = false;
  for (const line of text.split(/\r?\n/)) {
    const times = [...line.matchAll(/\d{1,2}(?::\d{2}){1,2}/g)].map((m) => parseSplit(m[0]));
    const sec = times.find((t) => t !== null);
    if (sec === undefined || sec === null) continue;
    const label = line.replace(/\d{1,2}(?::\d{2}){1,2}/g, " ");
    const run = label.match(/run(?:ning)?\s*(\d)/i);
    const station = STATION_WORDS.findIndex((re) => re.test(label));
    if (run && Number(run[1]) >= 1 && Number(run[1]) <= SPLIT_COUNT) {
      out.runs[Number(run[1]) - 1] = sec;
    } else if (/rox/i.test(label)) {
      out.roxzone = sec;
    } else if (/total|overall|finish|final/i.test(label)) {
      out.total = sec;
    } else if (station >= 0) {
      out.stations[station] = sec;
    } else {
      unlabeled.push(sec);
      continue;
    }
    labeled = true;
  }
  if (!labeled) {
    unlabeled.slice(0, 2 * SPLIT_COUNT).forEach((sec, i) => {
      (i % 2 === 0 ? out.runs : out.stations)[Math.floor(i / 2)] = sec;
    });
    if (unlabeled.length > 2 * SPLIT_COUNT) out.roxzone = unlabeled[2 * SPLIT_COUNT]!;
    if (unlabeled.length > 2 * SPLIT_COUNT + 1) out.total = unlabeled[2 * SPLIT_COUNT + 1]!;
  }
  return out;
}
