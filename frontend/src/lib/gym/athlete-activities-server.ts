import "server-only";
/** Feed, simpan/ubah/hapus aktivitas, detail aktivitas, kudos, dan komentar. */
import { getPool, withTransaction } from "@/lib/db";
import {
  computeActivityStats,
  defaultActivityTitle,
  FEED_CANDIDATES,
  FEED_SIZE,
  findGroupedActivities,
  gearMileageMoves,
  matchSegments,
  placeEffort,
  resolveActivityFigures,
  selectFeed,
  type ActivityType,
  type TrackPoint,
} from "./athlete";
import {
  assertOwnGear,
  athletes,
  cards,
  followingOf,
  loadActivity,
  loadSegments,
  memberActivities,
  moveGearMileage,
  ownActivity,
  selectActivities,
  syncWorkoutActivities,
  visibleActivity,
  withPoints,
  type Db,
} from "./athlete-store";
import {
  nameOf,
  type Activity,
  type ActivityCardView,
  type ActivityCommentView,
  type ActivityDetailView,
  type ActivityPatch,
  type SaveActivityInput,
} from "./athlete-views";

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
