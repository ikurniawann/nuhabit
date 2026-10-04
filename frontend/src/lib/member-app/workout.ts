/**
 * Adapter murni aplikasi member untuk workout, race, dan video teknik: bentuk
 * baris API repo ini → bentuk kontrak referensi NüHabit (camelCase, status
 * huruf besar) supaya layar porting tetap dekat dengan referensinya.
 */

import {
  sessionActiveSec,
  sessionCompletionPct,
  type Division,
  type WorkoutBlock,
  type WorkoutBlockResult,
  type WorkoutType,
} from "@/lib/gym/hyrox";
import type { RaceAnalysis } from "@/lib/gym/races";
import type { MemberRaceView, RaceEventRow } from "@/lib/gym/races-server";
import type { WorkoutHistoryItem, WorkoutSessionView as SessionRow, WorkoutView } from "@/lib/gym/training-server";

/* ── Workout ─────────────────────────────────────────────────────────── */

export interface GeneratedWorkout {
  id: string;
  type: WorkoutType;
  division: Division;
  blocks: WorkoutBlock[];
  totalTargetSec: number;
}

export interface WorkoutSession {
  id: string;
  workoutId: string;
  /** READY | STARTED | PAUSED | COMPLETED | PARTIAL */
  status: string;
  currentBlock: number;
  blockResults: WorkoutBlockResult[];
  createdAt: string;
}

export interface WorkoutSessionView {
  session: WorkoutSession;
  workout: GeneratedWorkout;
  activeSec: number;
  completionPct: number;
}

export interface WorkoutHistoryItemView {
  session: WorkoutSession;
  workoutType: WorkoutType;
  division: Division;
  totalBlocks: number;
  activeSec: number;
  completionPct: number;
}

export const toWorkout = (row: Pick<WorkoutView, "id" | "type" | "division" | "blocks" | "total_target_sec">): GeneratedWorkout => ({
  id: row.id,
  type: row.type,
  division: row.division,
  blocks: row.blocks,
  totalTargetSec: row.total_target_sec,
});

export const toSession = (row: SessionRow): WorkoutSession => ({
  id: row.id,
  workoutId: row.workout_id,
  status: row.status.toUpperCase(),
  currentBlock: row.current_block,
  blockResults: row.block_results ?? [],
  createdAt: row.created_at,
});

export function toSessionView(row: SessionRow, workout: GeneratedWorkout): WorkoutSessionView {
  const session = toSession(row);
  return {
    session,
    workout,
    activeSec: sessionActiveSec(session),
    completionPct: sessionCompletionPct(session, workout.blocks.length),
  };
}

/** Riwayat per sesi (bukan per workout), terbaru dulu; workout yang belum dimulai tidak tampil. */
export function flattenWorkoutHistory(workouts: readonly WorkoutHistoryItem[]): WorkoutHistoryItemView[] {
  return workouts
    .flatMap((w) =>
      w.sessions.map((row) => {
        const session = toSession(row);
        return {
          session,
          workoutType: w.type,
          division: w.division,
          totalBlocks: w.blocks.length,
          activeSec: sessionActiveSec(session),
          completionPct: sessionCompletionPct(session, w.blocks.length),
        };
      })
    )
    .sort((a, b) => new Date(b.session.createdAt).getTime() - new Date(a.session.createdAt).getTime());
}

/* ── Race ────────────────────────────────────────────────────────────── */

export interface RaceEvent {
  id: string;
  name: string;
  country: string;
  region: string;
  city: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  registrationUrl: string;
  imageUrl: string | null;
  /** ANNOUNCED | REGISTRATION_OPEN | ... | COMPLETED | CANCELLED */
  status: string;
}

export interface RaceEventView {
  event: RaceEvent;
  joined: boolean;
  participantCount: number;
}

export interface UserRace {
  id: string;
  raceEventId: string;
  division: Division;
  goalSec: number | null;
  resultSec: number | null;
  /** TRAINING | RACED | CANCELLED */
  status: string;
}

export interface MyRaceView {
  userRace: UserRace;
  event: RaceEvent;
  daysToRace: number;
  predictionSec: number | null;
  readinessScore: number;
  simulationCount: number;
  analysis: RaceAnalysis | null;
}

/** Foto kota race yang tersedia di aset aplikasi member (referensi: /img/race-<kota>.jpg). */
const RACE_IMAGE_CITIES = new Set([
  "bangkok",
  "berlin",
  "hongkong",
  "jakarta",
  "kualalumpur",
  "newyork",
  "singapore",
  "sydney",
]);

/** Path gambar race dari nama kota ("Kuala Lumpur" → "/img/race-kualalumpur.jpg"); null bila tidak ada fotonya. */
export function raceImagePath(city: string): string | null {
  const slug = city.toLowerCase().replace(/[^a-z]/g, "");
  return RACE_IMAGE_CITIES.has(slug) ? `/img/race-${slug}.jpg` : null;
}

/** `assetUrl` memetakan path aset aplikasi ("/img/...") ke URL publiknya. */
export function toRaceEvent(row: RaceEventRow, assetUrl: (path: string) => string): RaceEvent {
  const cityImage = raceImagePath(row.city);
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    region: row.region,
    city: row.city,
    venue: row.venue,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    registrationUrl: row.registration_url,
    imageUrl: row.image_url ?? (cityImage ? assetUrl(cityImage) : null),
    status: row.status.toUpperCase(),
  };
}

export function toMyRace(
  row: MemberRaceView,
  stats: { readiness: number; simulationCount: number },
  assetUrl: (path: string) => string
): MyRaceView {
  return {
    userRace: {
      id: row.id,
      raceEventId: row.race_event_id,
      division: row.division,
      goalSec: row.goal_sec,
      resultSec: row.result_sec,
      status: row.status.toUpperCase(),
    },
    event: toRaceEvent(row.event, assetUrl),
    daysToRace: row.days_until,
    predictionSec: row.prediction_sec,
    readinessScore: stats.readiness,
    simulationCount: stats.simulationCount,
    analysis: row.analysis,
  };
}

/** "01:30:00" → 5400. Format wajib hh:mm:ss seperti di referensi; selain itu null. */
export function parseHms(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/* ── Video teknik ────────────────────────────────────────────────────── */

/** ID video YouTube dari tautan watch?v=, youtu.be, atau embed; null untuk tautan lain (mis. pencarian). */
export function youtubeVideoId(url: string): string | null {
  const match = url.match(/(?:[?&]v=|youtu\.be\/|\/embed\/)([\w-]{6,})/);
  return match ? match[1]! : null;
}

/** URL embed untuk iframe; null bila tautannya bukan satu video (tidak bisa disematkan). */
export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}
