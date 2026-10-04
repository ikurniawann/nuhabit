import "server-only";
/** Rute tersimpan, heatmap, gear, pengaturan, statistik "You", dan segment. */
import { getPool } from "@/lib/db";
import {
  bestPerMember,
  downsample,
  HEATMAP_POINTS,
  personalRecords,
  rankOf,
  ROUTE_LIST_POINTS,
  ROUTE_POINTS,
  roundKm,
  SEGMENT_BOARD_SIZE,
  STATS_WEEKS,
  weeklyBuckets,
  type TrackPoint,
} from "./athlete";
import {
  athletes,
  countFollows,
  loadSegments,
  memberActivities,
  ownActivity,
  syncWorkoutActivities,
  type Db,
} from "./athlete-store";
import {
  AthleteError,
  DEFAULT_SETTINGS,
  nameOf,
  notFound,
  toEffort,
  toGear,
  toRoute,
  type AthleteSettingsView,
  type AthleteStatsView,
  type EffortRow,
  type GearInput,
  type GearRow,
  type GearView,
  type RouteRow,
  type RouteView,
} from "./athlete-views";

// ── Rute & heatmap ────────────────────────────────────────────────────────────

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
