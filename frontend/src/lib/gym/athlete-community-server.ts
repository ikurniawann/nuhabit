import "server-only";
/** Tantangan, klub, follow, dan profil atlet lain. */
import { getPool } from "@/lib/db";
import {
  canViewActivity,
  challengeProgressKm,
  followSuggestions,
  isChallengeRunning,
  PROFILE_ACTIVITIES,
  topOf,
  weeklyKmByMember,
  type ChallengeType,
} from "./athlete";
import {
  athletes,
  cards,
  countFollows,
  followersOf,
  followingOf,
  joinsBy,
  memberActivities,
  recentSummaries,
  syncWorkoutActivities,
} from "./athlete-store";
import {
  AthleteError,
  nameOf,
  notFound,
  type Activity,
  type AthleteLite,
  type ChallengeView,
} from "./athlete-views";

// ── Tantangan ─────────────────────────────────────────────────────────────────

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
