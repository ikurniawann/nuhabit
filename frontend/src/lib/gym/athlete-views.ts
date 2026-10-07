/**
 * Bentuk respons tab Train (kontrak NüHabit @nuhabit/contracts athlete.ts,
 * camelCase) beserta pemetaan baris DB → view. Murni: tanpa akses DB.
 */
import type {
  ActivitySplit,
  ActivityType,
  ActivityVisibility,
  ChallengeType,
  GearKind,
  LeaderboardEntry,
  PersonalRecords,
  TrackPoint,
  WeekBucket,
} from "./athlete";
import { downsample } from "./athlete";

/** Galat yang aman ditampilkan ke member (status HTTP + pesan). */
export class AthleteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AthleteError";
  }
}

export const notFound = (what: string) =>
  new AthleteError(404, `${what} tidak ditemukan`);

// ── Bentuk respons ────────────────────────────────────────────────────────────

export interface ActivityCardView {
  id: string;
  memberId: string;
  memberName: string;
  memberAvatarUrl: string | null;
  isOwn: boolean;
  type: ActivityType;
  title: string;
  startedAt: string;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  avgPaceSecPerKm: number | null;
  elevationGainM: number;
  visibility: ActivityVisibility;
  thumbnail: TrackPoint[];
  photoCount: number;
  kudosCount: number;
  hasKudoed: boolean;
  commentCount: number;
}

export interface ActivityDetailView extends ActivityCardView {
  description: string;
  points: TrackPoint[];
  photos: string[];
  splits: ActivitySplit[];
  bestSplitPaceSec: number | null;
  gearName: string | null;
  efforts: {
    segmentId: string;
    segmentName: string;
    distanceM: number;
    elapsedSec: number;
    rank: number;
    totalEfforts: number;
    isPersonalBest: boolean;
  }[];
  comments: ActivityCommentView[];
  groupedWith: { activityId: string; memberName: string }[];
}

export interface ActivityCommentView {
  id: string;
  memberId: string;
  memberName: string;
  text: string;
  createdAt: string;
}

export interface GearView {
  id: string;
  memberId: string;
  name: string;
  kind: GearKind;
  distanceM: number;
  retired: boolean;
}

export interface AthleteSettingsView {
  units: "METRIC" | "IMPERIAL";
  bookingReminders: boolean;
  weeklyGoalKm: number | null;
  language: "EN" | "ID";
}

export interface AthleteStatsView {
  weekly: WeekBucket[];
  totals: { activities: number; distanceKm: number; movingSec: number };
  thisWeekKm: number;
  goal: { targetKm: number | null; currentKm: number };
  prs: PersonalRecords;
  gear: GearView[];
  settings: AthleteSettingsView;
  followingCount: number;
  followerCount: number;
}

export interface SegmentView {
  id: string;
  name: string;
  type: ActivityType;
  distanceM: number;
  location: string;
  path: TrackPoint[];
}

export interface ChallengeView {
  challenge: {
    id: string;
    name: string;
    description: string;
    type: ChallengeType;
    targetKm: number;
    startsAt: string;
    endsAt: string;
  };
  joined: boolean;
  participantCount: number;
  progressKm: number;
  leaderboard: LeaderboardEntry[];
}

export interface AthleteLite {
  memberId: string;
  name: string;
  weeklyKm: number;
  isFollowing: boolean;
}

export interface RouteView {
  id: string;
  name: string;
  distanceM: number;
  points: TrackPoint[];
  createdAt: string;
}

// ── Masukan ───────────────────────────────────────────────────────────────────

export interface SaveActivityInput {
  type: ActivityType;
  title: string;
  description: string;
  startedAt: string | null;
  points: TrackPoint[];
  manualElapsedSec: number | null;
  gearId: string | null;
  visibility: ActivityVisibility;
  photos: string[];
}

export interface ActivityPatch {
  title?: string;
  description?: string;
  visibility?: ActivityVisibility;
  gearId?: string | null;
}

export interface GearInput {
  name: string;
  kind: GearKind;
  retired: boolean;
}

export const DEFAULT_SETTINGS: AthleteSettingsView = {
  units: "METRIC",
  bookingReminders: true,
  weeklyGoalKm: null,
  language: "ID",
};

// ── Baris DB → model ──────────────────────────────────────────────────────────

export interface ActivityRow {
  id: string;
  customer_id: string;
  type: ActivityType;
  title: string;
  description: string;
  started_at: Date;
  elapsed_sec: number;
  moving_sec: number;
  distance_m: string;
  avg_pace_sec_per_km: number | null;
  elevation_gain_m: string;
  visibility: ActivityVisibility;
  gear_id: string | null;
  photo_count: number;
  points?: TrackPoint[];
  photos?: string[];
}

export interface Activity {
  id: string;
  memberId: string;
  type: ActivityType;
  title: string;
  description: string;
  startedAt: Date;
  elapsedSec: number;
  movingSec: number;
  distanceM: number;
  avgPaceSecPerKm: number | null;
  elevationGainM: number;
  visibility: ActivityVisibility;
  gearId: string | null;
  photoCount: number;
  points: TrackPoint[];
  photos: string[];
}

export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    memberId: row.customer_id,
    type: row.type,
    title: row.title,
    description: row.description,
    startedAt: row.started_at,
    elapsedSec: row.elapsed_sec,
    movingSec: row.moving_sec,
    distanceM: Number(row.distance_m),
    avgPaceSecPerKm: row.avg_pace_sec_per_km,
    elevationGainM: Number(row.elevation_gain_m),
    visibility: row.visibility,
    gearId: row.gear_id,
    photoCount: row.photo_count,
    points: row.points ?? [],
    photos: row.photos ?? [],
  };
}

export interface Athlete {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export const nameOf = (map: Map<string, Athlete>, id: string) =>
  map.get(id)?.name ?? "Athlete";

export interface RouteRow {
  id: string;
  name: string;
  distance_m: string;
  points: TrackPoint[];
  created_at: Date;
}

export const toRoute = (r: RouteRow, maxPoints: number): RouteView => ({
  id: r.id,
  name: r.name,
  distanceM: Number(r.distance_m),
  points: downsample(r.points, maxPoints),
  createdAt: r.created_at.toISOString(),
});

export interface GearRow {
  id: string;
  customer_id: string;
  name: string;
  kind: GearKind;
  distance_m: string;
  retired: boolean;
}

export const toGear = (r: GearRow): GearView => ({
  id: r.id,
  memberId: r.customer_id,
  name: r.name,
  kind: r.kind,
  distanceM: Number(r.distance_m),
  retired: r.retired,
});

export interface EffortRow {
  segment_id: string;
  customer_id: string;
  elapsed_sec: number;
  created_at: Date;
}

export const toEffort = (r: EffortRow) => ({
  segmentId: r.segment_id,
  memberId: r.customer_id,
  elapsedSec: r.elapsed_sec,
  createdAt: r.created_at.toISOString(),
});
