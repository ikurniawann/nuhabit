import "server-only";
/**
 * Kueri bersama modul atlet: muat aktivitas, profil atlet, graf follow,
 * kartu aktivitas, segment, dan sinkron workout → aktivitas.
 */
import type { Pool, PoolClient } from "pg";
import {
  canViewActivity,
  downsample,
  FEED_CANDIDATES,
  THUMBNAIL_POINTS,
  workoutActivityTitle,
  workoutRunDistanceM,
  type ActivityType,
  type TrackPoint,
} from "./athlete";
import {
  AthleteError,
  notFound,
  toActivity,
  type Activity,
  type ActivityCardView,
  type ActivityRow,
  type Athlete,
  type SegmentView,
} from "./athlete-views";

export type Db = Pool | PoolClient;

// ── Aktivitas ─────────────────────────────────────────────────────────────────

const SUMMARY_COLUMNS = `a.id, a.customer_id, a.type, a.title, a.description, a.started_at, a.elapsed_sec,
  a.moving_sec, a.distance_m, a.avg_pace_sec_per_km, a.elevation_gain_m, a.visibility, a.gear_id,
  jsonb_array_length(a.photos)::int AS photo_count`;
const FULL_COLUMNS = `${SUMMARY_COLUMNS}, a.points, a.photos`;

export async function selectActivities(
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

export const memberActivities = (db: Db, customerId: string, full = true) =>
  selectActivities(
    db,
    "WHERE a.customer_id = $1 ORDER BY a.started_at DESC",
    [customerId],
    full,
  );

/** Aktivitas terbaru semua atlet tanpa titik GPS (papan, saran, tantangan). */
export const recentSummaries = (db: Db, limit = FEED_CANDIDATES * 5) =>
  selectActivities(db, "ORDER BY a.started_at DESC LIMIT $1", [limit], false);

export async function loadActivity(db: Db, id: string): Promise<Activity> {
  const [activity] = await selectActivities(db, "WHERE a.id = $1", [id]);
  if (!activity) throw notFound("Aktivitas");
  return activity;
}

/** Aktivitas yang boleh dilihat viewer; milik orang lain yang privat = 403. */
export async function visibleActivity(
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
export async function ownActivity(
  db: Db,
  id: string,
  customerId: string,
): Promise<Activity> {
  const activity = await loadActivity(db, id);
  if (activity.memberId !== customerId) throw notFound("Aktivitas");
  return activity;
}

// ── Atlet & graf sosial ───────────────────────────────────────────────────────

export async function athletes(
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

export async function followingOf(
  db: Db,
  customerId: string,
): Promise<Set<string>> {
  const { rows } = await db.query<{ followee_id: string }>(
    `SELECT followee_id FROM gym.athlete_follows WHERE follower_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return new Set(rows.map((r) => r.followee_id));
}

export async function followersOf(
  db: Db,
  customerId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ follower_id: string }>(
    `SELECT follower_id FROM gym.athlete_follows WHERE followee_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows.map((r) => r.follower_id);
}

export async function countFollows(
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

/** Keanggotaan grup (tantangan/klub): group_id → customer_id berurutan. */
export async function joinsBy(
  db: Db,
  sql: string,
): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ group_id: string; customer_id: string }>(
    sql,
  );
  const out = new Map<string, string[]>();
  for (const r of rows)
    out.set(r.group_id, [...(out.get(r.group_id) ?? []), r.customer_id]);
  return out;
}

// ── Kartu aktivitas ───────────────────────────────────────────────────────────

/** Satu batch kartu = empat kueri (atlet, kudos, kudos saya, komentar). */
export async function cards(
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
export async function withPoints(
  db: Db,
  activities: Activity[],
): Promise<Activity[]> {
  if (activities.length === 0) return activities;
  const { rows } = await db.query<{ id: string; points: TrackPoint[] }>(
    `SELECT id, points FROM gym.athlete_activities WHERE id = ANY($1::uuid[])`,
    [activities.map((a) => a.id)],
  );
  const points = new Map(rows.map((r) => [r.id, r.points]));
  return activities.map((a) => ({ ...a, points: points.get(a.id) ?? [] }));
}

// ── Gear & segment ────────────────────────────────────────────────────────────

export async function assertOwnGear(
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

export async function moveGearMileage(
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

export async function loadSegments(db: Db): Promise<SegmentView[]> {
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
