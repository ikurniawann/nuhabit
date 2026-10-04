/**
 * Aturan domain atlet (tab Train): statistik jejak GPS, split, pace, rekor
 * pribadi, target mingguan, grafik 8 minggu, pencocokan segment, leaderboard,
 * progres tantangan, dan graf sosial. Port dari NüHabit
 * packages/domain/src/athlete.ts + aturan server modul training/engagement.
 * Murni: tanpa I/O, semua waktu masuk lewat argumen.
 */

export const ACTIVITY_TYPES = ["RUN", "RIDE", "WALK", "WORKOUT"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_VISIBILITIES = [
  "EVERYONE",
  "FOLLOWERS",
  "PRIVATE",
] as const;
export type ActivityVisibility = (typeof ACTIVITY_VISIBILITIES)[number];

export const GEAR_KINDS = ["SHOES", "BIKE"] as const;
export type GearKind = (typeof GEAR_KINDS)[number];

export const CHALLENGE_TYPES = ["ANY", ...ACTIVITY_TYPES] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

/** Satu sampel GPS; `t` milidetik sejak mulai, `ele` meter (opsional). */
export interface TrackPoint {
  t: number;
  lat: number;
  lng: number;
  ele?: number;
}

export interface ActivitySplit {
  /** Indeks km mulai 1. */
  km: number;
  distanceM: number;
  paceSecPerKm: number;
  /** Split 1000 m penuh (split terakhir bisa parsial). */
  full: boolean;
}

export interface ActivityStats {
  distanceM: number;
  elapsedSec: number;
  movingSec: number;
  avgPaceSecPerKm: number | null;
  elevationGainM: number;
  splits: ActivitySplit[];
  bestSplitPaceSec: number | null;
}

/** Batas server: jumlah dan ukuran foto per aktivitas, panjang komentar. */
export const MAX_ACTIVITY_PHOTOS = 2;
export const MAX_PHOTO_BYTES = 400_000;
export const MAX_COMMENT_LENGTH = 500;
/** Titik thumbnail kartu feed, rute, dan heatmap. */
export const THUMBNAIL_POINTS = 40;
export const ROUTE_POINTS = 500;
export const ROUTE_LIST_POINTS = 200;
export const HEATMAP_POINTS = 120;
/** Ukuran feed, profil, leaderboard, saran follow, grafik. */
export const FEED_SIZE = 30;
export const FEED_CANDIDATES = 200;
export const PROFILE_ACTIVITIES = 20;
export const LEADERBOARD_ROWS = 5;
export const SEGMENT_BOARD_SIZE = 20;
export const SUGGESTION_COUNT = 8;
export const STATS_WEEKS = 8;
/** Zona waktu studio (WIB) untuk batas minggu. */
export const STUDIO_TZ_OFFSET_MIN = 7 * 60;

const EARTH_R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const msOf = (iso: string | Date) =>
  iso instanceof Date ? iso.getTime() : new Date(iso).getTime();

/** Jarak lingkaran besar dalam meter. */
export function haversineM(
  a: Pick<TrackPoint, "lat" | "lng">,
  b: Pick<TrackPoint, "lat" | "lng">,
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/** Di bawah kecepatan ini sebuah jeda dihitung berhenti (auto-pause). */
const MOVING_THRESHOLD_MPS = 0.5;

/** Statistik dihitung dari jejak, bukan dipercaya dari klien. */
export function computeActivityStats(
  points: readonly TrackPoint[],
): ActivityStats {
  if (points.length < 2) {
    return {
      distanceM: 0,
      elapsedSec: points.length
        ? Math.round(points[points.length - 1]!.t / 1000)
        : 0,
      movingSec: 0,
      avgPaceSecPerKm: null,
      elevationGainM: 0,
      splits: [],
      bestSplitPaceSec: null,
    };
  }

  let distanceM = 0;
  let movingSec = 0;
  let elevationGainM = 0;
  const splits: ActivitySplit[] = [];
  let splitDist = 0;
  let splitMoving = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const dt = (curr.t - prev.t) / 1000;
    if (dt <= 0) continue;
    const d = haversineM(prev, curr);
    distanceM += d;
    if (prev.ele !== undefined && curr.ele !== undefined) {
      const rise = curr.ele - prev.ele;
      if (rise > 0.3) elevationGainM += rise; // abaikan jitter GPS
    }
    const isMoving = d / dt >= MOVING_THRESHOLD_MPS;
    if (isMoving) movingSec += dt;

    // Satu sampel bisa melewati batas km.
    let remaining = d;
    let remainingT = isMoving ? dt : 0;
    while (remaining > 0) {
      const take = Math.min(1000 - splitDist, remaining);
      const frac = take / remaining;
      splitDist += take;
      splitMoving += remainingT * frac;
      remainingT *= 1 - frac;
      remaining -= take;
      if (splitDist >= 1000) {
        splits.push({
          km: splits.length + 1,
          distanceM: 1000,
          paceSecPerKm: Math.round(splitMoving),
          full: true,
        });
        splitDist = 0;
        splitMoving = 0;
      }
    }
  }
  if (splitDist > 50) {
    splits.push({
      km: splits.length + 1,
      distanceM: Math.round(splitDist),
      paceSecPerKm: Math.round((splitMoving / splitDist) * 1000),
      full: false,
    });
  }

  const fullSplits = splits.filter((s) => s.full);
  return {
    distanceM: Math.round(distanceM),
    elapsedSec: Math.round(
      (points[points.length - 1]!.t - points[0]!.t) / 1000,
    ),
    movingSec: Math.round(movingSec),
    avgPaceSecPerKm:
      distanceM >= 50 ? Math.round(movingSec / (distanceM / 1000)) : null,
    elevationGainM: Math.round(elevationGainM),
    splits,
    bestSplitPaceSec: fullSplits.length
      ? Math.min(...fullSplits.map((s) => s.paceSecPerKm))
      : null,
  };
}

/** Ambil paling banyak `max` titik, rata sepanjang jejak, titik awal dan akhir tetap. */
export function downsample<T>(points: readonly T[], max: number): T[] {
  if (max < 2 || points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

/** Judul bawaan server bila klien mengirim judul kosong. */
export function defaultActivityTitle(
  type: ActivityType,
  startedAt: Date,
  tzOffsetMin = STUDIO_TZ_OFFSET_MIN,
): string {
  const hour = new Date(
    startedAt.getTime() + tzOffsetMin * 60_000,
  ).getUTCHours();
  const part = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const word = { RUN: "run", RIDE: "ride", WALK: "walk", WORKOUT: "workout" }[
    type
  ];
  return `${part} ${word}`;
}

export interface ActivityFigures {
  elapsedSec: number;
  movingSec: number;
  distanceM: number;
  avgPaceSecPerKm: number | null;
  elevationGainM: number;
}

/**
 * Angka yang disimpan: dari jejak bila ada (min. 2 titik), selain itu angka
 * manual klien (workout gym tanpa GPS tetap punya durasi).
 */
export function resolveActivityFigures(
  points: readonly TrackPoint[],
  manual: {
    elapsedSec?: number | null;
    movingSec?: number | null;
    distanceM?: number | null;
  },
): ActivityFigures {
  if (points.length >= 2) {
    const s = computeActivityStats(points);
    return {
      elapsedSec: s.elapsedSec,
      movingSec: s.movingSec,
      distanceM: s.distanceM,
      avgPaceSecPerKm: s.avgPaceSecPerKm,
      elevationGainM: s.elevationGainM,
    };
  }
  const elapsedSec = Math.max(0, Math.round(manual.elapsedSec ?? 0));
  return {
    elapsedSec,
    movingSec: Math.max(0, Math.round(manual.movingSec ?? elapsedSec)),
    distanceM: Math.max(0, manual.distanceM ?? 0),
    avgPaceSecPerKm: null,
    elevationGainM: 0,
  };
}

/** Siapa yang boleh melihat aktivitas ini. */
export function canViewActivity(
  activity: { memberId: string; visibility: ActivityVisibility },
  viewerId: string,
  viewerFollows: (memberId: string) => boolean,
): boolean {
  if (activity.memberId === viewerId) return true;
  if (activity.visibility === "EVERYONE") return true;
  if (activity.visibility === "FOLLOWERS")
    return viewerFollows(activity.memberId);
  return false;
}

/**
 * Feed: kandidat terbaru dulu, disaring visibilitas; cakupan "following" hanya
 * aktivitas sendiri dan orang yang diikuti.
 */
export function selectFeed<
  T extends { memberId: string; visibility: ActivityVisibility },
>(
  candidates: readonly T[],
  viewerId: string,
  following: ReadonlySet<string>,
  followingOnly: boolean,
  limit = FEED_SIZE,
): T[] {
  const out: T[] = [];
  for (const a of candidates) {
    if (!canViewActivity(a, viewerId, (id) => following.has(id))) continue;
    if (followingOnly && a.memberId !== viewerId && !following.has(a.memberId))
      continue;
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Segment ──────────────────────────────────────────────────────────────────

export interface SegmentLike {
  id: string;
  type: ActivityType;
  distanceM: number;
  path: TrackPoint[];
}

/** Seberapa dekat (meter) jejak harus lewat gerbang segment. */
export const SEGMENT_MATCH_RADIUS_M = 60;

export interface SegmentMatch<S extends SegmentLike = SegmentLike> {
  segment: S;
  startIdx: number;
  endIdx: number;
  elapsedSec: number;
}

/**
 * Cocok bila jejak lewat gerbang awal lalu gerbang akhir dengan jarak tempuh
 * 80%..135% panjang segment; waktu effort dari stempel waktu titik.
 */
export function matchSegments<S extends SegmentLike>(
  segments: readonly S[],
  activityType: ActivityType,
  points: readonly TrackPoint[],
): SegmentMatch<S>[] {
  if (points.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1]! + haversineM(points[i - 1]!, points[i]!));

  const matches: SegmentMatch<S>[] = [];
  for (const segment of segments) {
    if (segment.type !== activityType || segment.path.length < 2) continue;
    const gateStart = segment.path[0]!;
    const gateEnd = segment.path[segment.path.length - 1]!;

    const startIdx = points.findIndex(
      (p) => haversineM(p, gateStart) <= SEGMENT_MATCH_RADIUS_M,
    );
    if (startIdx < 0) continue;

    let endIdx = -1;
    for (let j = startIdx + 1; j < points.length; j++) {
      if (haversineM(points[j]!, gateEnd) > SEGMENT_MATCH_RADIUS_M) continue;
      const traveled = cum[j]! - cum[startIdx]!;
      if (
        traveled >= segment.distanceM * 0.8 &&
        traveled <= segment.distanceM * 1.35
      ) {
        endIdx = j;
        break;
      }
    }
    if (endIdx < 0) continue;

    matches.push({
      segment,
      startIdx,
      endIdx,
      elapsedSec: Math.max(
        1,
        Math.round((points[endIdx]!.t - points[startIdx]!.t) / 1000),
      ),
    });
  }
  return matches;
}

export interface EffortLike {
  memberId: string;
  elapsedSec: number;
}

/** Satu baris per atlet (effort terbaiknya), tercepat dulu. */
export function bestPerMember<E extends EffortLike>(
  efforts: readonly E[],
): E[] {
  const best = new Map<string, E>();
  for (const e of efforts) {
    const current = best.get(e.memberId);
    if (!current || e.elapsedSec < current.elapsedSec) best.set(e.memberId, e);
  }
  return [...best.values()].sort((a, b) => a.elapsedSec - b.elapsedSec);
}

/** Peringkat 1-based atlet di papan best-per-member, null bila belum ada. */
export function rankOf(
  board: readonly EffortLike[],
  memberId: string,
): number | null {
  const i = board.findIndex((e) => e.memberId === memberId);
  return i < 0 ? null : i + 1;
}

/** Posisi satu effort di papannya: peringkat, total atlet, dan apakah PR. */
export function placeEffort(
  effort: EffortLike,
  allEfforts: readonly EffortLike[],
): { rank: number; totalEfforts: number; isPersonalBest: boolean } {
  const board = bestPerMember(allEfforts);
  const mine = board.find((e) => e.memberId === effort.memberId);
  return {
    rank: rankOf(board, effort.memberId) ?? 0,
    totalEfforts: board.length,
    isPersonalBest:
      effort.elapsedSec <= (mine?.elapsedSec ?? effort.elapsedSec),
  };
}

// ── Grouped activities ────────────────────────────────────────────────────────

export interface GroupCandidate {
  id: string;
  memberId: string;
  type: ActivityType;
  startedAt: string | Date;
  start: Pick<TrackPoint, "lat" | "lng"> | null;
}

/** "Latihan bareng": tipe sama, mulai dalam 45 menit, titik awal dalam 500 m, atlet lain. */
export function findGroupedActivities(
  activity: GroupCandidate,
  candidates: readonly GroupCandidate[],
  opts: { windowMin?: number; radiusM?: number } = {},
): string[] {
  const windowMs = (opts.windowMin ?? 45) * 60_000;
  const radiusM = opts.radiusM ?? 500;
  const start = activity.start;
  if (!start) return [];
  const t0 = msOf(activity.startedAt);
  return candidates
    .filter(
      (c) =>
        c.id !== activity.id &&
        c.memberId !== activity.memberId &&
        c.type === activity.type &&
        c.start !== null &&
        Math.abs(msOf(c.startedAt) - t0) <= windowMs &&
        haversineM(c.start, start) <= radiusM,
    )
    .map((c) => c.id);
}

// ── Tantangan & leaderboard ─────────────────────────────────────────────────────

export interface ChallengeLike {
  type: ChallengeType;
  startsAt: string | Date;
  endsAt: string | Date;
}

export interface ContributionLike {
  type: ActivityType;
  distanceM: number;
  startedAt: string | Date;
}

/** Km 1 desimal dari meter (pembulatan setengah ke atas). */
export const roundKm = (metres: number) => Math.round(metres / 100) / 10;

/** Km yang dikumpulkan dalam jendela tantangan, sesuai tipenya. */
export function challengeProgressKm(
  challenge: ChallengeLike,
  activities: readonly ContributionLike[],
): number {
  const from = msOf(challenge.startsAt);
  const to = msOf(challenge.endsAt);
  const total = activities
    .filter(
      (a) =>
        (challenge.type === "ANY" || a.type === challenge.type) &&
        msOf(a.startedAt) >= from &&
        msOf(a.startedAt) <= to,
    )
    .reduce((sum, a) => sum + a.distanceM, 0);
  return roundKm(total);
}

/** Tantangan yang masih bisa diikuti: belum berakhir. */
export const isChallengeRunning = (
  challenge: Pick<ChallengeLike, "endsAt">,
  now: Date,
) => msOf(challenge.endsAt) >= now.getTime();

export interface LeaderboardEntry {
  memberName: string;
  km: number;
  isMe: boolean;
}

/** Lima teratas berdasarkan km (urutan stabil saat seri). */
export function topOf(
  rows: readonly LeaderboardEntry[],
  size = LEADERBOARD_ROWS,
): LeaderboardEntry[] {
  return [...rows].sort((a, b) => b.km - a.km).slice(0, size);
}

// ── Minggu, statistik, rekor ──────────────────────────────────────────────────

const DAY_MS = 24 * 3600_000;

/** Senin 00:00 (zona studio) dari minggu yang memuat `at`. */
export function startOfWeek(
  at: Date,
  tzOffsetMin = STUDIO_TZ_OFFSET_MIN,
): Date {
  const local = new Date(at.getTime() + tzOffsetMin * 60_000);
  const day = (local.getUTCDay() + 6) % 7; // Senin = 0
  const midnight =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    day * DAY_MS;
  return new Date(midnight - tzOffsetMin * 60_000);
}

export interface WeekBucket {
  /** ISO awal minggu (Senin). */
  weekStart: string;
  distanceKm: number;
  activities: number;
  movingSec: number;
}

export interface SummaryLike {
  startedAt: string | Date;
  distanceM: number;
  movingSec: number;
}

/** `weeks` minggu terakhir, terlama dulu; minggu kosong tetap ada. */
export function weeklyBuckets(
  activities: readonly SummaryLike[],
  now: Date,
  weeks = STATS_WEEKS,
  tzOffsetMin = STUDIO_TZ_OFFSET_MIN,
): WeekBucket[] {
  const current = startOfWeek(now, tzOffsetMin).getTime();
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = current - i * 7 * DAY_MS;
    const end = start + 7 * DAY_MS;
    const inWeek = activities.filter(
      (a) => msOf(a.startedAt) >= start && msOf(a.startedAt) < end,
    );
    buckets.push({
      weekStart: new Date(start).toISOString(),
      distanceKm: roundKm(inWeek.reduce((s, a) => s + a.distanceM, 0)),
      activities: inWeek.length,
      movingSec: inWeek.reduce((s, a) => s + a.movingSec, 0),
    });
  }
  return buckets;
}

/** Km minggu ini per atlet (papan klub dan saran follow). */
export function weeklyKmByMember(
  activities: readonly (SummaryLike & { memberId: string })[],
  now: Date,
  tzOffsetMin = STUDIO_TZ_OFFSET_MIN,
): Map<string, number> {
  const from = startOfWeek(now, tzOffsetMin).getTime();
  const metres = new Map<string, number>();
  for (const a of activities) {
    if (msOf(a.startedAt) < from) continue;
    metres.set(a.memberId, (metres.get(a.memberId) ?? 0) + a.distanceM);
  }
  return new Map([...metres].map(([id, m]) => [id, roundKm(m)]));
}

export interface PersonalRecords {
  best1kPaceSec: number | null;
  best5kSec: number | null;
  best10kSec: number | null;
  longestDistanceM: number;
  longestMovingSec: number;
}

export interface RecordLike {
  type: ActivityType;
  distanceM: number;
  movingSec: number;
  points: readonly TrackPoint[];
}

/** 1k dari split penuh tercepat; 5k/10k estimasi pace bergerak seluruh aktivitas. */
export function personalRecords(
  activities: readonly RecordLike[],
): PersonalRecords {
  const runs = activities.filter(
    (a) => a.type === "RUN" && a.distanceM > 0 && a.movingSec > 0,
  );
  const bestSplitPaces = runs
    .map((a) => computeActivityStats(a.points).bestSplitPaceSec)
    .filter((p): p is number => p !== null);
  const estFor = (meters: number): number | null => {
    const eligible = runs.filter((a) => a.distanceM >= meters);
    if (!eligible.length) return null;
    return Math.min(
      ...eligible.map((a) => Math.round((a.movingSec * meters) / a.distanceM)),
    );
  };
  return {
    best1kPaceSec: bestSplitPaces.length ? Math.min(...bestSplitPaces) : null,
    best5kSec: estFor(5000),
    best10kSec: estFor(10_000),
    longestDistanceM: activities.reduce((m, a) => Math.max(m, a.distanceM), 0),
    longestMovingSec: activities.reduce((m, a) => Math.max(m, a.movingSec), 0),
  };
}

/** Progres target mingguan 0..1 (0 bila target belum diatur). */
export function weeklyGoalProgress(
  targetKm: number | null,
  currentKm: number,
): number {
  return targetKm && targetKm > 0 ? Math.min(1, currentKm / targetKm) : 0;
}

// ── Gear ─────────────────────────────────────────────────────────────────────

/**
 * Perubahan mileage saat gear aktivitas diganti: jarak pindah dari gear lama
 * ke gear baru (atau hilang saat aktivitas dihapus, `next` = null).
 */
export function gearMileageMoves(
  previousGearId: string | null,
  nextGearId: string | null,
  distanceM: number,
): { gearId: string; deltaM: number }[] {
  if (previousGearId === nextGearId || distanceM <= 0) return [];
  const moves: { gearId: string; deltaM: number }[] = [];
  if (previousGearId)
    moves.push({ gearId: previousGearId, deltaM: -distanceM });
  if (nextGearId) moves.push({ gearId: nextGearId, deltaM: distanceM });
  return moves;
}

/** Gear yang cocok untuk tipe aktivitas: sepeda untuk RIDE, sepatu selain itu. */
export const gearKindFor = (type: ActivityType): GearKind | null =>
  type === "RIDE" ? "BIKE" : type === "WORKOUT" ? null : "SHOES";

// ── Sosial ───────────────────────────────────────────────────────────────────

/** Saran follow: atlet aktif yang berlatih, belum diikuti, bukan diri sendiri. */
export function followSuggestions(
  activeMemberIds: readonly string[],
  viewerId: string,
  following: ReadonlySet<string>,
  trains: ReadonlySet<string>,
  count = SUGGESTION_COUNT,
): string[] {
  return activeMemberIds
    .filter((id) => id !== viewerId && !following.has(id) && trains.has(id))
    .slice(0, count);
}

// ── Workout HYROX sebagai aktivitas ──────────────────────────────────────────

/** Jarak workout = total blok lari (stasiun bukan kilometer). */
export function workoutRunDistanceM(
  blocks: readonly { kind: string; distanceM: number | null }[],
): number {
  return blocks.reduce(
    (sum, b) => sum + (b.kind === "RUN" && b.distanceM ? b.distanceM : 0),
    0,
  );
}

const WORKOUT_TITLES: Record<string, string> = {
  FULL_SIMULATION: "HYROX simulation",
  COVERAGE: "HYROX coverage session",
  QUICK: "Quick HYROX session",
};
export const workoutActivityTitle = (type: string) =>
  WORKOUT_TITLES[type] ?? "HYROX station practice";
