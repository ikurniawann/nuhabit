import type { Pool, PoolClient } from "pg";
import { getPool, withTransaction } from "@/lib/db";
import {
  bestPerMember,
  canViewActivity,
  challengeProgressKm,
  computeActivityStats,
  defaultActivityTitle,
  downsample,
  FEED_CANDIDATES,
  FEED_SIZE,
  findGroupedActivities,
  followSuggestions,
  gearMileageMoves,
  HEATMAP_POINTS,
  isChallengeRunning,
  matchSegments,
  personalRecords,
  placeEffort,
  PROFILE_ACTIVITIES,
  rankOf,
  resolveActivityFigures,
  ROUTE_LIST_POINTS,
  ROUTE_POINTS,
  roundKm,
  SEGMENT_BOARD_SIZE,
  selectFeed,
  STATS_WEEKS,
  THUMBNAIL_POINTS,
  topOf,
  weeklyBuckets,
  weeklyKmByMember,
  workoutActivityTitle,
  workoutRunDistanceM,
  type ActivitySplit,
  type ActivityType,
  type ActivityVisibility,
  type ChallengeType,
  type GearKind,
  type LeaderboardEntry,
  type PersonalRecords,
  type TrackPoint,
  type WeekBucket,
} from "./athlete";

/**
 * Data atlet (tab Train) untuk API member. Bentuk respons mengikuti kontrak
 * NüHabit (@nuhabit/contracts athlete.ts, camelCase) supaya layar hasil port
 * memakai data apa adanya.
 */

type Db = Pool | PoolClient;

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

const notFound = (what: string) =>
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

// ── Baris DB ──────────────────────────────────────────────────────────────────

interface ActivityRow {
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

interface Activity {
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

const SUMMARY_COLUMNS = `a.id, a.customer_id, a.type, a.title, a.description, a.started_at, a.elapsed_sec,
  a.moving_sec, a.distance_m, a.avg_pace_sec_per_km, a.elevation_gain_m, a.visibility, a.gear_id,
  jsonb_array_length(a.photos)::int AS photo_count`;
const FULL_COLUMNS = `${SUMMARY_COLUMNS}, a.points, a.photos`;

function toActivity(row: ActivityRow): Activity {
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

async function selectActivities(
  db: Db,
  where: string,
  params: unknown[],
  full = true,
): Promise<Activity[]> {
  const { rows } = await db.query<ActivityRow>(
    `SELECT ${full ? FULL_COLUMNS : SUMMARY_COLUMNS} FROM gym.athlete_activities a ${where}`,
    params,
  );
  return rows.map(toActivity);
}

const memberActivities = (db: Db, customerId: string, full = true) =>
  selectActivities(
    db,
    "WHERE a.customer_id = $1 ORDER BY a.started_at DESC",
    [customerId],
    full,
  );

/** Aktivitas terbaru semua atlet tanpa titik GPS (papan, saran, tantangan). */
const recentSummaries = (db: Db, limit = FEED_CANDIDATES * 5) =>
  selectActivities(db, "ORDER BY a.started_at DESC LIMIT $1", [limit], false);

async function loadActivity(db: Db, id: string): Promise<Activity> {
  const [activity] = await selectActivities(db, "WHERE a.id = $1", [id]);
  if (!activity) throw notFound("Aktivitas");
  return activity;
}

// ── Atlet & graf sosial ───────────────────────────────────────────────────────

interface Athlete {
  id: string;
  name: string;
  avatarUrl: string | null;
}

async function athletes(
  db: Db,
  ids: Iterable<string>,
): Promise<Map<string, Athlete>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const { rows } = await db.query<{
    id: string;
    name: string | null;
    photo_url: string | null;
  }>(
    `SELECT id, name, photo_url FROM pos.pos_customers WHERE id = ANY($1::uuid[])`,
    [list],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: r.name || "Athlete", avatarUrl: r.photo_url },
    ]),
  );
}

const nameOf = (map: Map<string, Athlete>, id: string) =>
  map.get(id)?.name ?? "Athlete";

async function followingOf(db: Db, customerId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ followee_id: string }>(
    `SELECT followee_id FROM gym.athlete_follows WHERE follower_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return new Set(rows.map((r) => r.followee_id));
}

async function followersOf(db: Db, customerId: string): Promise<string[]> {
  const { rows } = await db.query<{ follower_id: string }>(
    `SELECT follower_id FROM gym.athlete_follows WHERE followee_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows.map((r) => r.follower_id);
}

async function countFollows(
  db: Db,
  customerId: string,
): Promise<{ following: number; followers: number }> {
  const { rows } = await db.query<{ following: number; followers: number }>(
    `SELECT (SELECT count(*) FROM gym.athlete_follows WHERE follower_id = $1)::int AS following,
            (SELECT count(*) FROM gym.athlete_follows WHERE followee_id = $1)::int AS followers`,
    [customerId],
  );
  return rows[0]!;
}

// ── Kartu aktivitas ───────────────────────────────────────────────────────────

/** Satu batch kartu = empat kueri (atlet, kudos, kudos saya, komentar). */
async function cards(
  db: Db,
  viewerId: string,
  activities: Activity[],
): Promise<ActivityCardView[]> {
  if (activities.length === 0) return [];
  const ids = activities.map((a) => a.id);
  const [people, counts] = await Promise.all([
    athletes(
      db,
      activities.map((a) => a.memberId),
    ),
    db.query<{ id: string; kudos: number; kudoed: boolean; comments: number }>(
      `SELECT x.id,
              (SELECT count(*) FROM gym.athlete_kudos k WHERE k.activity_id = x.id)::int AS kudos,
              EXISTS (SELECT 1 FROM gym.athlete_kudos k WHERE k.activity_id = x.id AND k.customer_id = $2) AS kudoed,
              (SELECT count(*) FROM gym.athlete_activity_comments c WHERE c.activity_id = x.id)::int AS comments
         FROM unnest($1::uuid[]) AS x(id)`,
      [ids, viewerId],
    ),
  ]);
  const byId = new Map(counts.rows.map((r) => [r.id, r]));
  return activities.map((a) => {
    const athlete = people.get(a.memberId);
    const c = byId.get(a.id);
    return {
      id: a.id,
      memberId: a.memberId,
      memberName: athlete?.name ?? "Athlete",
      memberAvatarUrl: athlete?.avatarUrl ?? null,
      isOwn: a.memberId === viewerId,
      type: a.type,
      title: a.title,
      startedAt: a.startedAt.toISOString(),
      distanceM: a.distanceM,
      movingSec: a.movingSec,
      elapsedSec: a.elapsedSec,
      avgPaceSecPerKm: a.avgPaceSecPerKm,
      elevationGainM: a.elevationGainM,
      visibility: a.visibility,
      thumbnail: downsample(a.points, THUMBNAIL_POINTS),
      photoCount: a.photoCount,
      kudosCount: c?.kudos ?? 0,
      hasKudoed: c?.kudoed ?? false,
      commentCount: c?.comments ?? 0,
    };
  });
}

/** Lengkapi titik GPS (untuk thumbnail) pada aktivitas ringkas. */
async function withPoints(db: Db, activities: Activity[]): Promise<Activity[]> {
  if (activities.length === 0) return activities;
  const { rows } = await db.query<{ id: string; points: TrackPoint[] }>(
    `SELECT id, points FROM gym.athlete_activities WHERE id = ANY($1::uuid[])`,
    [activities.map((a) => a.id)],
  );
  const points = new Map(rows.map((r) => [r.id, r.points]));
  return activities.map((a) => ({ ...a, points: points.get(a.id) ?? [] }));
}

// ── Workout HYROX selesai = aktivitas WORKOUT ─────────────────────────────────

/**
 * Sesi workout yang selesai (gym.workout_sessions, status completed) masuk ke
 * log latihan sebagai aktivitas WORKOUT, seperti FinishSession di referensi.
 * Idempoten lewat indeks unik (source_type, source_id). Tanpa `customerId`
 * menyinkronkan semua member (dipakai feed).
 */
export async function syncWorkoutActivities(
  db: Db,
  customerId?: string,
): Promise<void> {
  const { rows } = await db.query<{
    id: string;
    customer_id: string;
    type: string;
    blocks: { kind: string; distanceM: number | null }[];
    started_at: Date;
    active_sec: number;
    total_pause_sec: number;
  }>(
    `SELECT s.id, s.customer_id, w.type, w.blocks, COALESCE(s.started_at, s.created_at) AS started_at,
            s.active_sec, s.total_pause_sec
       FROM gym.workout_sessions s
       JOIN gym.workouts w ON w.id = s.workout_id
      WHERE s.status = 'completed'
        AND ($1::uuid IS NULL OR s.customer_id = $1)
        AND NOT EXISTS (SELECT 1 FROM gym.athlete_activities a
                         WHERE a.source_type = 'workout_session' AND a.source_id = s.id)`,
    [customerId ?? null],
  );
  for (const s of rows) {
    await db.query(
      `INSERT INTO gym.athlete_activities
         (customer_id, type, title, started_at, elapsed_sec, moving_sec, distance_m, visibility, source_type, source_id)
       VALUES ($1, 'WORKOUT', $2, $3, $4, $5, $6, 'EVERYONE', 'workout_session', $7)
       ON CONFLICT DO NOTHING`,
      [
        s.customer_id,
        workoutActivityTitle(s.type),
        s.started_at,
        s.active_sec + s.total_pause_sec,
        s.active_sec,
        workoutRunDistanceM(s.blocks ?? []),
        s.id,
      ],
    );
  }
}

// ── Feed & aktivitas ──────────────────────────────────────────────────────────

export async function feed(
  viewerId: string,
  followingOnly: boolean,
): Promise<ActivityCardView[]> {
  const db = getPool();
  await syncWorkoutActivities(db);
  const [following, candidates] = await Promise.all([
    followingOf(db, viewerId),
    selectActivities(
      db,
      "ORDER BY a.started_at DESC LIMIT $1",
      [FEED_CANDIDATES],
      false,
    ),
  ]);
  const visible = selectFeed(
    candidates,
    viewerId,
    following,
    followingOnly,
    FEED_SIZE,
  );
  return cards(db, viewerId, await withPoints(db, visible));
}

export async function myActivities(
  customerId: string,
): Promise<ActivityCardView[]> {
  const db = getPool();
  await syncWorkoutActivities(db, customerId);
  return cards(db, customerId, await memberActivities(db, customerId));
}

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

async function assertOwnGear(
  db: Db,
  gearId: string,
  customerId: string,
): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM gym.athlete_gear WHERE id = $1 AND customer_id = $2`,
    [gearId, customerId],
  );
  if (rows.length === 0) throw notFound("Gear");
}

async function moveGearMileage(
  db: Db,
  moves: { gearId: string; deltaM: number }[],
): Promise<void> {
  for (const move of moves) {
    await db.query(
      `UPDATE gym.athlete_gear SET distance_m = GREATEST(0, distance_m + $2), updated_at = now() WHERE id = $1`,
      [move.gearId, move.deltaM],
    );
  }
}

/**
 * Simpan aktivitas beserta turunannya: statistik dari jejak, effort segment
 * yang dilewati, dan mileage gear.
 */
export async function saveActivity(
  customerId: string,
  input: SaveActivityInput,
): Promise<ActivityCardView> {
  const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
  const figures = resolveActivityFigures(input.points, {
    elapsedSec: input.manualElapsedSec,
  });
  const title =
    input.title.trim() || defaultActivityTitle(input.type, startedAt);

  const activity = await withTransaction(async (client) => {
    if (input.gearId) await assertOwnGear(client, input.gearId, customerId);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO gym.athlete_activities
         (customer_id, type, title, description, started_at, elapsed_sec, moving_sec, distance_m,
          avg_pace_sec_per_km, elevation_gain_m, points, photos, visibility, gear_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)
       RETURNING id`,
      [
        customerId,
        input.type,
        title,
        input.description.trim(),
        startedAt,
        figures.elapsedSec,
        figures.movingSec,
        figures.distanceM,
        figures.avgPaceSecPerKm,
        figures.elevationGainM,
        JSON.stringify(input.points),
        JSON.stringify(input.photos),
        input.visibility,
        input.gearId,
      ],
    );
    const id = rows[0]!.id;

    if (input.points.length >= 2) {
      const segments = await loadSegments(client);
      for (const match of matchSegments(segments, input.type, input.points)) {
        await client.query(
          `INSERT INTO gym.athlete_segment_efforts (segment_id, activity_id, customer_id, elapsed_sec)
           VALUES ($1, $2, $3, $4) ON CONFLICT (activity_id, segment_id) DO NOTHING`,
          [match.segment.id, id, customerId, match.elapsedSec],
        );
      }
    }
    await moveGearMileage(
      client,
      gearMileageMoves(null, input.gearId, figures.distanceM),
    );
    return loadActivity(client, id);
  });
  const [card] = await cards(getPool(), customerId, [activity]);
  return card!;
}

/** Aktivitas yang boleh dilihat viewer; milik orang lain yang privat = 403. */
async function visibleActivity(
  db: Db,
  id: string,
  viewerId: string,
): Promise<Activity> {
  const activity = await loadActivity(db, id);
  const following = await followingOf(db, viewerId);
  if (!canViewActivity(activity, viewerId, (m) => following.has(m))) {
    throw new AthleteError(403, "Aktivitas ini privat.");
  }
  return activity;
}

/** Aktivitas milik sendiri; milik orang lain dilaporkan tidak ada. */
async function ownActivity(
  db: Db,
  id: string,
  customerId: string,
): Promise<Activity> {
  const activity = await loadActivity(db, id);
  if (activity.memberId !== customerId) throw notFound("Aktivitas");
  return activity;
}

export async function activityDetail(
  viewerId: string,
  id: string,
): Promise<ActivityDetailView> {
  const db = getPool();
  const activity = await visibleActivity(db, id, viewerId);
  const stats = computeActivityStats(activity.points);
  const [[card], efforts, comments, groupedWith, gear] = await Promise.all([
    cards(db, viewerId, [activity]),
    effortViews(db, activity),
    commentViews(db, activity.id),
    groupedViews(db, activity),
    activity.gearId
      ? db.query<{ name: string }>(
          `SELECT name FROM gym.athlete_gear WHERE id = $1`,
          [activity.gearId],
        )
      : null,
  ]);
  return {
    ...card!,
    description: activity.description,
    points: activity.points,
    photos: activity.photos,
    splits: stats.splits,
    bestSplitPaceSec: stats.bestSplitPaceSec,
    gearName: gear?.rows[0]?.name ?? null,
    efforts,
    comments,
    groupedWith,
  };
}

async function effortViews(
  db: Db,
  activity: Activity,
): Promise<ActivityDetailView["efforts"]> {
  const { rows } = await db.query<{
    segment_id: string;
    name: string;
    distance_m: string;
    elapsed_sec: number;
    board: { memberId: string; elapsedSec: number }[];
  }>(
    `SELECT e.segment_id, s.name, s.distance_m, e.elapsed_sec,
            (SELECT jsonb_agg(jsonb_build_object('memberId', o.customer_id, 'elapsedSec', o.elapsed_sec))
               FROM gym.athlete_segment_efforts o WHERE o.segment_id = e.segment_id) AS board
       FROM gym.athlete_segment_efforts e
       JOIN gym.athlete_segments s ON s.id = e.segment_id
      WHERE e.activity_id = $1
      ORDER BY s.name`,
    [activity.id],
  );
  return rows.map((r) => ({
    segmentId: r.segment_id,
    segmentName: r.name,
    distanceM: Number(r.distance_m),
    elapsedSec: r.elapsed_sec,
    ...placeEffort(
      { memberId: activity.memberId, elapsedSec: r.elapsed_sec },
      r.board ?? [],
    ),
  }));
}

async function commentViews(
  db: Db,
  activityId: string,
): Promise<ActivityCommentView[]> {
  const { rows } = await db.query<{
    id: string;
    customer_id: string;
    text: string;
    created_at: Date;
  }>(
    `SELECT id, customer_id, text, created_at FROM gym.athlete_activity_comments
      WHERE activity_id = $1 ORDER BY created_at`,
    [activityId],
  );
  const people = await athletes(
    db,
    rows.map((r) => r.customer_id),
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.customer_id,
    memberName: nameOf(people, r.customer_id),
    text: r.text,
    createdAt: r.created_at.toISOString(),
  }));
}

async function groupedViews(
  db: Db,
  activity: Activity,
): Promise<ActivityDetailView["groupedWith"]> {
  if (activity.points.length === 0) return [];
  const { rows } = await db.query<{
    id: string;
    customer_id: string;
    type: ActivityType;
    started_at: Date;
    start: TrackPoint | null;
  }>(
    `SELECT id, customer_id, type, started_at, points->0 AS start
       FROM gym.athlete_activities
      WHERE type = $1 AND customer_id <> $2 AND started_at BETWEEN $3::timestamptz - interval '1 hour'
                                                                AND $3::timestamptz + interval '1 hour'
      ORDER BY started_at DESC LIMIT $4`,
    [activity.type, activity.memberId, activity.startedAt, FEED_CANDIDATES],
  );
  const toCandidate = (r: (typeof rows)[number]) => ({
    id: r.id,
    memberId: r.customer_id,
    type: r.type,
    startedAt: r.started_at,
    start: r.start,
  });
  const matched = findGroupedActivities(
    {
      id: activity.id,
      memberId: activity.memberId,
      type: activity.type,
      startedAt: activity.startedAt,
      start: activity.points[0] ?? null,
    },
    rows.map(toCandidate),
  );
  const owners = new Map(rows.map((r) => [r.id, r.customer_id]));
  const people = await athletes(
    db,
    matched.map((id) => owners.get(id)!),
  );
  return matched.map((id) => ({
    activityId: id,
    memberName: nameOf(people, owners.get(id)!),
  }));
}

export interface ActivityPatch {
  title?: string;
  description?: string;
  visibility?: ActivityVisibility;
  gearId?: string | null;
}

export async function updateActivity(
  customerId: string,
  id: string,
  patch: ActivityPatch,
): Promise<ActivityCardView> {
  const updated = await withTransaction(async (client) => {
    const current = await ownActivity(client, id, customerId);
    const setGear = patch.gearId !== undefined;
    const nextGear = setGear ? (patch.gearId ?? null) : current.gearId;
    if (setGear && nextGear) await assertOwnGear(client, nextGear, customerId);
    await client.query(
      `UPDATE gym.athlete_activities
          SET title = $2, description = $3, visibility = $4, gear_id = $5, updated_at = now()
        WHERE id = $1`,
      [
        id,
        patch.title !== undefined
          ? patch.title.trim() || current.title
          : current.title,
        patch.description !== undefined
          ? patch.description.trim()
          : current.description,
        patch.visibility ?? current.visibility,
        nextGear,
      ],
    );
    // Pindah sepatu = mileage ikut pindah.
    await moveGearMileage(
      client,
      gearMileageMoves(current.gearId, nextGear, current.distanceM),
    );
    return loadActivity(client, id);
  });
  const [card] = await cards(getPool(), customerId, [updated]);
  return card!;
}

export async function deleteActivity(
  customerId: string,
  id: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const current = await ownActivity(client, id, customerId);
    await moveGearMileage(
      client,
      gearMileageMoves(current.gearId, null, current.distanceM),
    );
    await client.query(`DELETE FROM gym.athlete_activities WHERE id = $1`, [
      id,
    ]);
  });
}

// ── Kudos & komentar ──────────────────────────────────────────────────────────

export async function toggleKudos(
  customerId: string,
  activityId: string,
): Promise<{ kudoed: boolean; count: number }> {
  const db = getPool();
  await visibleActivity(db, activityId, customerId);
  const removed = await db.query(
    `DELETE FROM gym.athlete_kudos WHERE activity_id = $1 AND customer_id = $2`,
    [activityId, customerId],
  );
  if (removed.rowCount === 0) {
    await db.query(
      `INSERT INTO gym.athlete_kudos (activity_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [activityId, customerId],
    );
  }
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM gym.athlete_kudos WHERE activity_id = $1`,
    [activityId],
  );
  return { kudoed: removed.rowCount === 0, count: rows[0]!.count };
}

export async function addComment(
  customerId: string,
  activityId: string,
  text: string,
): Promise<ActivityCommentView> {
  const db = getPool();
  await visibleActivity(db, activityId, customerId);
  const { rows } = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO gym.athlete_activity_comments (activity_id, customer_id, text) VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [activityId, customerId, text.trim()],
  );
  const people = await athletes(db, [customerId]);
  return {
    id: rows[0]!.id,
    memberId: customerId,
    memberName: nameOf(people, customerId),
    text: text.trim(),
    createdAt: rows[0]!.created_at.toISOString(),
  };
}

// ── Rute & heatmap ────────────────────────────────────────────────────────────

export interface RouteView {
  id: string;
  name: string;
  distanceM: number;
  points: TrackPoint[];
  createdAt: string;
}

interface RouteRow {
  id: string;
  name: string;
  distance_m: string;
  points: TrackPoint[];
  created_at: Date;
}

const toRoute = (r: RouteRow, maxPoints: number): RouteView => ({
  id: r.id,
  name: r.name,
  distanceM: Number(r.distance_m),
  points: downsample(r.points, maxPoints),
  createdAt: r.created_at.toISOString(),
});

export async function routes(customerId: string): Promise<RouteView[]> {
  const { rows } = await getPool().query<RouteRow>(
    `SELECT id, name, distance_m, points, created_at FROM gym.athlete_routes
      WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows.map((r) => toRoute(r, ROUTE_LIST_POINTS));
}

/** Jejak aktivitas sendiri yang disukai jadi rute yang bisa diulang. */
export async function saveRoute(
  customerId: string,
  activityId: string,
  name: string,
): Promise<RouteView> {
  const db = getPool();
  const activity = await ownActivity(db, activityId, customerId);
  if (activity.points.length < 2)
    throw new AthleteError(400, "Aktivitas ini tidak punya jejak GPS.");
  const { rows } = await db.query<RouteRow>(
    `INSERT INTO gym.athlete_routes (customer_id, name, points, distance_m) VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, name, distance_m, points, created_at`,
    [
      customerId,
      name.trim() || activity.title,
      JSON.stringify(downsample(activity.points, ROUTE_POINTS)),
      activity.distanceM,
    ],
  );
  return toRoute(rows[0]!, ROUTE_POINTS);
}

export async function deleteRoute(
  customerId: string,
  routeId: string,
): Promise<void> {
  const { rowCount } = await getPool().query(
    `DELETE FROM gym.athlete_routes WHERE id = $1 AND customer_id = $2`,
    [routeId, customerId],
  );
  if (rowCount === 0) throw notFound("Rute");
}

/** Semua jejak GPS member, ditipiskan untuk digambar. */
export async function heatmap(
  customerId: string,
): Promise<{ tracks: TrackPoint[][] }> {
  const { rows } = await getPool().query<{ points: TrackPoint[] }>(
    `SELECT points FROM gym.athlete_activities
      WHERE customer_id = $1 AND jsonb_array_length(points) > 1 ORDER BY started_at DESC`,
    [customerId],
  );
  return { tracks: rows.map((r) => downsample(r.points, HEATMAP_POINTS)) };
}

// ── Gear & pengaturan ─────────────────────────────────────────────────────────

interface GearRow {
  id: string;
  customer_id: string;
  name: string;
  kind: GearKind;
  distance_m: string;
  retired: boolean;
}

const toGear = (r: GearRow): GearView => ({
  id: r.id,
  memberId: r.customer_id,
  name: r.name,
  kind: r.kind,
  distanceM: Number(r.distance_m),
  retired: r.retired,
});

const GEAR_COLUMNS = "id, customer_id, name, kind, distance_m, retired";

export async function gearList(
  customerId: string,
  db: Db = getPool(),
): Promise<GearView[]> {
  const { rows } = await db.query<GearRow>(
    `SELECT ${GEAR_COLUMNS} FROM gym.athlete_gear WHERE customer_id = $1 ORDER BY retired, created_at`,
    [customerId],
  );
  return rows.map(toGear);
}

export interface GearInput {
  name: string;
  kind: GearKind;
  retired: boolean;
}

/** Buat atau ubah gear. Jarak tidak bisa diubah: jumlah aktivitas yang memakainya. */
export async function upsertGear(
  customerId: string,
  gearId: string | null,
  input: GearInput,
): Promise<GearView> {
  const db = getPool();
  const { rows } = gearId
    ? await db.query<GearRow>(
        `UPDATE gym.athlete_gear SET name = $3, kind = $4, retired = $5, updated_at = now()
          WHERE id = $1 AND customer_id = $2 RETURNING ${GEAR_COLUMNS}`,
        [gearId, customerId, input.name.trim(), input.kind, input.retired],
      )
    : await db.query<GearRow>(
        `INSERT INTO gym.athlete_gear (customer_id, name, kind, retired) VALUES ($1, $2, $3, $4)
         RETURNING ${GEAR_COLUMNS}`,
        [customerId, input.name.trim(), input.kind, input.retired],
      );
  if (!rows[0]) throw notFound("Gear");
  return toGear(rows[0]);
}

const DEFAULT_SETTINGS: AthleteSettingsView = {
  units: "METRIC",
  bookingReminders: true,
  weeklyGoalKm: null,
  language: "ID",
};

export async function getSettings(
  customerId: string,
  db: Db = getPool(),
): Promise<AthleteSettingsView> {
  const { rows } = await db.query<{
    units: AthleteSettingsView["units"];
    booking_reminders: boolean;
    weekly_goal_km: string | null;
    language: AthleteSettingsView["language"];
  }>(
    `SELECT units, booking_reminders, weekly_goal_km, language FROM gym.athlete_settings WHERE customer_id = $1`,
    [customerId],
  );
  const r = rows[0];
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    units: r.units,
    bookingReminders: r.booking_reminders,
    weeklyGoalKm: r.weekly_goal_km === null ? null : Number(r.weekly_goal_km),
    language: r.language,
  };
}

/** Patch parsial; `weeklyGoalKm: null` menghapus target, tidak dikirim = tetap. */
export async function updateSettings(
  customerId: string,
  patch: Partial<AthleteSettingsView>,
): Promise<AthleteSettingsView> {
  const next = { ...(await getSettings(customerId)), ...patch };
  await getPool().query(
    `INSERT INTO gym.athlete_settings (customer_id, units, booking_reminders, weekly_goal_km, language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (customer_id) DO UPDATE SET units = EXCLUDED.units, booking_reminders = EXCLUDED.booking_reminders,
       weekly_goal_km = EXCLUDED.weekly_goal_km, language = EXCLUDED.language, updated_at = now()`,
    [
      customerId,
      next.units,
      next.bookingReminders,
      next.weeklyGoalKm,
      next.language,
    ],
  );
  return next;
}

// ── Statistik "You" ───────────────────────────────────────────────────────────

export async function stats(
  customerId: string,
  now = new Date(),
): Promise<AthleteStatsView> {
  const db = getPool();
  await syncWorkoutActivities(db, customerId);
  const [activities, settings, gear, follows] = await Promise.all([
    memberActivities(db, customerId),
    getSettings(customerId, db),
    gearList(customerId, db),
    countFollows(db, customerId),
  ]);
  const weekly = weeklyBuckets(activities, now, STATS_WEEKS);
  const thisWeekKm = weekly[weekly.length - 1]?.distanceKm ?? 0;
  return {
    weekly,
    totals: {
      activities: activities.length,
      distanceKm: roundKm(activities.reduce((s, a) => s + a.distanceM, 0)),
      movingSec: activities.reduce((s, a) => s + a.movingSec, 0),
    },
    thisWeekKm,
    goal: { targetKm: settings.weeklyGoalKm, currentKm: thisWeekKm },
    prs: personalRecords(activities),
    gear,
    settings,
    followingCount: follows.following,
    followerCount: follows.followers,
  };
}

// ── Segment ───────────────────────────────────────────────────────────────────

async function loadSegments(db: Db): Promise<SegmentView[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    type: ActivityType;
    distance_m: string;
    location: string;
    path: TrackPoint[];
  }>(
    `SELECT id, name, type, distance_m, location, path FROM gym.athlete_segments ORDER BY name`,
  );
  return rows.map(({ distance_m, ...r }) => ({
    ...r,
    distanceM: Number(distance_m),
  }));
}

interface EffortRow {
  segment_id: string;
  customer_id: string;
  elapsed_sec: number;
  created_at: Date;
}

const toEffort = (r: EffortRow) => ({
  segmentId: r.segment_id,
  memberId: r.customer_id,
  elapsedSec: r.elapsed_sec,
  createdAt: r.created_at.toISOString(),
});

export async function segments(customerId: string) {
  const db = getPool();
  const [list, { rows }] = await Promise.all([
    loadSegments(db),
    db.query<EffortRow>(
      `SELECT segment_id, customer_id, elapsed_sec, created_at FROM gym.athlete_segment_efforts`,
    ),
  ]);
  const efforts = rows.map(toEffort);
  return list.map((segment) => {
    const all = efforts.filter((e) => e.segmentId === segment.id);
    const board = bestPerMember(all);
    const myRank = rankOf(board, customerId);
    return {
      segment,
      effortCount: all.length,
      bestElapsedSec: board[0]?.elapsedSec ?? null,
      myBestElapsedSec: myRank ? board[myRank - 1]!.elapsedSec : null,
      myRank,
    };
  });
}

export async function segmentDetail(customerId: string, segmentId: string) {
  const db = getPool();
  const segment = (await loadSegments(db)).find((s) => s.id === segmentId);
  if (!segment) throw notFound("Segment");
  const { rows } = await db.query<EffortRow>(
    `SELECT segment_id, customer_id, elapsed_sec, created_at FROM gym.athlete_segment_efforts WHERE segment_id = $1`,
    [segmentId],
  );
  const board = bestPerMember(rows.map(toEffort));
  const shown = board.slice(0, SEGMENT_BOARD_SIZE);
  const people = await athletes(
    db,
    shown.map((e) => e.memberId),
  );
  return {
    segment,
    leaderboard: shown.map((e, i) => ({
      rank: i + 1,
      memberId: e.memberId,
      memberName: nameOf(people, e.memberId),
      elapsedSec: e.elapsedSec,
      createdAt: e.createdAt,
      isMe: e.memberId === customerId,
    })),
    myRank: rankOf(board, customerId),
  };
}

// ── Tantangan ─────────────────────────────────────────────────────────────────

async function joinsBy(db: Db, sql: string): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ group_id: string; customer_id: string }>(
    sql,
  );
  const out = new Map<string, string[]>();
  for (const r of rows)
    out.set(r.group_id, [...(out.get(r.group_id) ?? []), r.customer_id]);
  return out;
}

/** Tantangan yang belum berakhir, progres saya, dan lima teratas peserta. */
export async function challenges(
  customerId: string,
  now = new Date(),
): Promise<ChallengeView[]> {
  const db = getPool();
  const [{ rows }, participants, activities] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      description: string;
      type: ChallengeType;
      target_km: string;
      starts_at: Date;
      ends_at: Date;
    }>(
      `SELECT id, name, description, type, target_km, starts_at, ends_at FROM gym.athlete_challenges ORDER BY starts_at`,
    ),
    joinsBy(
      db,
      `SELECT challenge_id AS group_id, customer_id FROM gym.athlete_challenge_joins ORDER BY joined_at`,
    ),
    recentSummaries(db),
  ]);
  const byMember = new Map<string, Activity[]>();
  for (const a of activities)
    byMember.set(a.memberId, [...(byMember.get(a.memberId) ?? []), a]);
  const people = await athletes(db, [...participants.values()].flat());

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      targetKm: Number(r.target_km),
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
    }))
    .filter((c) => isChallengeRunning(c, now))
    .map((challenge) => {
      const ids = participants.get(challenge.id) ?? [];
      return {
        challenge,
        joined: ids.includes(customerId),
        participantCount: ids.length,
        progressKm: challengeProgressKm(
          challenge,
          byMember.get(customerId) ?? [],
        ),
        leaderboard: topOf(
          ids.map((id) => ({
            memberName: nameOf(people, id),
            km: challengeProgressKm(challenge, byMember.get(id) ?? []),
            isMe: id === customerId,
          })),
        ),
      };
    });
}

/** Ikut tantangan (idempoten: dua kali tekan = satu keanggotaan). */
export async function joinChallenge(
  customerId: string,
  challengeId: string,
): Promise<void> {
  const { rowCount } = await getPool().query(
    `INSERT INTO gym.athlete_challenge_joins (challenge_id, customer_id)
     SELECT id, $2 FROM gym.athlete_challenges WHERE id = $1
     ON CONFLICT DO NOTHING`,
    [challengeId, customerId],
  );
  if (rowCount === 0) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM gym.athlete_challenges WHERE id = $1`,
      [challengeId],
    );
    if (rows.length === 0) throw notFound("Tantangan");
  }
}

export async function leaveChallenge(
  customerId: string,
  challengeId: string,
): Promise<void> {
  await getPool().query(
    `DELETE FROM gym.athlete_challenge_joins WHERE challenge_id = $1 AND customer_id = $2`,
    [challengeId, customerId],
  );
}

// ── Klub ──────────────────────────────────────────────────────────────────────

export async function clubs(customerId: string, now = new Date()) {
  const db = getPool();
  const [{ rows }, members, activities] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      description: string;
      location: string;
    }>(
      `SELECT id, name, description, location FROM gym.athlete_clubs ORDER BY name`,
    ),
    joinsBy(
      db,
      `SELECT club_id AS group_id, customer_id FROM gym.athlete_club_members ORDER BY joined_at`,
    ),
    recentSummaries(db),
  ]);
  const weekly = weeklyKmByMember(activities, now);
  const people = await athletes(db, [...members.values()].flat());
  return rows.map((club) => {
    const ids = members.get(club.id) ?? [];
    return {
      club: { ...club, memberIds: ids },
      joined: ids.includes(customerId),
      memberCount: ids.length,
      weeklyLeaderboard: topOf(
        ids.map((id) => ({
          memberName: nameOf(people, id),
          km: weekly.get(id) ?? 0,
          isMe: id === customerId,
        })),
      ),
    };
  });
}

export async function toggleClub(
  customerId: string,
  clubId: string,
): Promise<{ joined: boolean }> {
  const db = getPool();
  const removed = await db.query(
    `DELETE FROM gym.athlete_club_members WHERE club_id = $1 AND customer_id = $2`,
    [clubId, customerId],
  );
  if ((removed.rowCount ?? 0) > 0) return { joined: false };
  const { rowCount } = await db.query(
    `INSERT INTO gym.athlete_club_members (club_id, customer_id) SELECT id, $2 FROM gym.athlete_clubs WHERE id = $1`,
    [clubId, customerId],
  );
  if (rowCount === 0) throw notFound("Klub");
  return { joined: true };
}

// ── Sosial ────────────────────────────────────────────────────────────────────

/**
 * Following, followers, dan saran follow. `query` mencari atlet aktif
 * berdasarkan nama (pencarian di Explore) sebagai pengganti saran.
 */
export async function social(customerId: string, query = "", now = new Date()) {
  const db = getPool();
  const search = query.trim();
  const [following, followers, activities, active] = await Promise.all([
    followingOf(db, customerId),
    followersOf(db, customerId),
    recentSummaries(db),
    db.query<{ id: string }>(
      `SELECT id FROM pos.pos_customers
        WHERE COALESCE(is_active, true) AND ($1 = '' OR name ILIKE '%' || $1 || '%')
        ORDER BY created_at LIMIT 200`,
      [search],
    ),
  ]);
  const weekly = weeklyKmByMember(activities, now);
  const trains = new Set(activities.map((a) => a.memberId));
  const activeIds = active.rows.map((r) => r.id);
  const suggestions = search
    ? activeIds.filter((id) => id !== customerId).slice(0, 20)
    : followSuggestions(activeIds, customerId, following, trains);
  const people = await athletes(db, [
    ...following,
    ...followers,
    ...suggestions,
  ]);
  const lite = (ids: Iterable<string>): AthleteLite[] =>
    [...ids].map((id) => ({
      memberId: id,
      name: nameOf(people, id),
      weeklyKm: weekly.get(id) ?? 0,
      isFollowing: following.has(id),
    }));
  return {
    following: lite(following),
    followers: lite(followers),
    suggestions: lite(suggestions),
  };
}

export async function toggleFollow(
  customerId: string,
  targetId: string,
): Promise<{ following: boolean }> {
  if (customerId === targetId)
    throw new AthleteError(400, "Tidak bisa mengikuti diri sendiri.");
  const db = getPool();
  const target = await athletes(db, [targetId]);
  if (!target.has(targetId)) throw notFound("Member");
  const removed = await db.query(
    `DELETE FROM gym.athlete_follows WHERE follower_id = $1 AND followee_id = $2`,
    [customerId, targetId],
  );
  if ((removed.rowCount ?? 0) > 0) return { following: false };
  await db.query(
    `INSERT INTO gym.athlete_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [customerId, targetId],
  );
  return { following: true };
}

export async function profile(viewerId: string, targetId: string) {
  const db = getPool();
  const target = (await athletes(db, [targetId])).get(targetId);
  if (!target) throw notFound("Member");
  await syncWorkoutActivities(db, targetId);
  const [following, activities, counts] = await Promise.all([
    followingOf(db, viewerId),
    memberActivities(db, targetId),
    countFollows(db, targetId),
  ]);
  const visible = activities.filter((a) =>
    canViewActivity(a, viewerId, (m) => following.has(m)),
  );
  return {
    member: {
      id: target.id,
      fullName: target.name,
      avatarUrl: target.avatarUrl,
    },
    isMe: targetId === viewerId,
    isFollowing: following.has(targetId),
    followerCount: counts.followers,
    followingCount: counts.following,
    totals: {
      activities: visible.length,
      distanceKm: visible.reduce((s, a) => s + a.distanceM, 0) / 1000,
      movingSec: visible.reduce((s, a) => s + a.movingSec, 0),
    },
    activities: await cards(db, viewerId, visible.slice(0, PROFILE_ACTIVITIES)),
  };
}
