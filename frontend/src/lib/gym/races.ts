/**
 * Race HYROX: kalender race, race milik member, prediksi waktu, kesiapan,
 * dan analisis hasil. Port dari packages/domain/src/races.ts. Fungsi murni.
 */

import type { Division } from "./hyrox";

export const RACE_STATUSES = [
  "announced",
  "registration_open",
  "sold_out",
  "upcoming",
  "ongoing",
  "completed",
  "cancelled",
] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];

export const RACE_REGIONS = ["ASIA", "EUROPE", "AMERICAS", "OCEANIA"] as const;
export type RaceRegion = (typeof RACE_REGIONS)[number];

export const RACE_STATUS_LABELS: Record<RaceStatus, string> = {
  announced: "Diumumkan",
  registration_open: "Pendaftaran buka",
  sold_out: "Sold out",
  upcoming: "Segera",
  ongoing: "Berlangsung",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

/** Member boleh menargetkan race yang belum selesai dan tidak batal. */
export function canTargetRace(status: RaceStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

/* ── Race milik member ───────────────────────────────────────────────── */

export const MEMBER_RACE_STATUSES = ["training", "raced", "cancelled"] as const;
export type MemberRaceStatus = (typeof MEMBER_RACE_STATUSES)[number];

export const MEMBER_RACE_STATUS_LABELS: Record<MemberRaceStatus, string> = {
  training: "Latihan menuju race",
  raced: "Sudah race",
  cancelled: "Batal",
};

export interface MemberRaceUpdate {
  division?: Division;
  goalSec?: number | null;
  resultSec?: number;
  cancel?: boolean;
}

export type MemberRacePatch =
  | { ok: true; status: MemberRaceStatus; division?: Division; goalSec?: number | null; resultSec?: number }
  | { ok: false; error: string };

/**
 * Validasi perubahan race milik member. Mencatat hasil memindahkan status ke
 * `raced`; hasil hanya bisa dicatat sekali dan race yang sudah dicatat tidak
 * bisa diubah lagi.
 */
export function planMemberRaceUpdate(current: MemberRaceStatus, update: MemberRaceUpdate): MemberRacePatch {
  // Hanya race yang masih dilatih yang bisa diubah; batal dihidupkan lagi lewat daftar ulang.
  if (current !== "training") {
    return { ok: false, error: current === "raced" ? "Hasil race ini sudah dicatat." : "Race ini sudah dibatalkan." };
  }
  if (update.goalSec !== undefined && update.goalSec !== null && !(update.goalSec > 0)) {
    return { ok: false, error: "Target waktu harus lebih dari 0." };
  }
  if (update.resultSec !== undefined && !(update.resultSec > 0)) {
    return { ok: false, error: "Waktu hasil harus lebih dari 0." };
  }
  if (update.cancel && update.resultSec !== undefined) {
    return { ok: false, error: "Pilih salah satu: batal atau catat hasil." };
  }
  const status: MemberRaceStatus = update.cancel ? "cancelled" : update.resultSec !== undefined ? "raced" : "training";
  return {
    ok: true,
    status,
    ...(update.division !== undefined && { division: update.division }),
    ...(update.goalSec !== undefined && { goalSec: update.goalSec }),
    ...(update.resultSec !== undefined && { resultSec: Math.round(update.resultSec) }),
  };
}

/* ── Prediksi & analisis ─────────────────────────────────────────────── */

/** Faktor race day: adrenalin dan lintasan resmi memangkas ±3% dari simulasi terbaik. */
export const RACE_DAY_FACTOR = 0.97;
export const READINESS_WINDOW_DAYS = 28;
/** Rencana 3 sesi/minggu selama 4 minggu. */
export const READINESS_TARGET_ACTIVITIES = 12;

/** Prediksi dari simulasi penuh yang selesai: yang terbaik × 0,97. Null bila belum ada. */
export function predictRaceSec(fullSimActiveSecs: readonly number[]): number | null {
  const valid = fullSimActiveSecs.filter((s) => Number.isFinite(s) && s > 0);
  if (valid.length === 0) return null;
  return Math.round(Math.min(...valid) * RACE_DAY_FACTOR);
}

/** 0–100: konsistensi latihan 28 hari terakhir dibanding rencana 12 aktivitas. */
export function raceReadinessScore(activityDates: readonly (string | Date)[], now: Date): number {
  const end = now.getTime();
  const cutoff = end - READINESS_WINDOW_DAYS * 86_400_000;
  const recent = activityDates.filter((d) => {
    const t = new Date(d).getTime();
    return t >= cutoff && t <= end;
  }).length;
  return Math.max(0, Math.min(100, Math.round((recent / READINESS_TARGET_ACTIVITIES) * 100)));
}

export interface RaceAnalysis {
  /** Positif = lebih lambat dari target. */
  vsGoalSec: number | null;
  vsPredictionSec: number | null;
  achievedGoal: boolean | null;
}

export function analyzeRace(resultSec: number, goalSec: number | null, predictionSec: number | null): RaceAnalysis {
  return {
    vsGoalSec: goalSec !== null ? resultSec - goalSec : null,
    vsPredictionSec: predictionSec !== null ? resultSec - predictionSec : null,
    achievedGoal: goalSec !== null ? resultSec <= goalSec : null,
  };
}

/** Hari tersisa sampai race (0 bila hari ini atau sudah lewat). */
export function daysUntil(startsAt: string | Date, now: Date): number {
  return Math.max(0, Math.ceil((new Date(startsAt).getTime() - now.getTime()) / 86_400_000));
}
