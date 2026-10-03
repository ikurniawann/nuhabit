import { z } from "zod";
import { getPool } from "@/lib/db";
import { challengeValues, settleChallengeRewards, type ChallengeRow } from "@/lib/crm/engagement/server";
import { challengePhase, challengeProgress, leaderboardName } from "@/lib/crm/engagement/rules";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const LEADERBOARD_SIZE = 5;

/**
 * GET — challenge yang belum berakhir (dan yang sudah diikuti, meski berakhir
 * dalam 7 hari terakhir), dengan progres member dan papan peringkat.
 * Hadiah yang sudah tercapai dibagikan lebih dulu.
 */
export const GET = withMemberSession("Gagal memuat challenge", async (customerId) => {
  await settleChallengeRewards(customerId);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.description, c.metric, c.target::float AS target, c.starts_at, c.ends_at,
            c.reward_xp, c.reward_ark_idr::float AS reward_ark_idr,
            j.joined_at, j.rewarded_at,
            (SELECT count(*)::int FROM crm.challenge_joins x WHERE x.challenge_id = c.id) AS participant_count
       FROM crm.challenges c
       LEFT JOIN crm.challenge_joins j ON j.challenge_id = c.id AND j.customer_id = $1
      WHERE c.is_active AND (c.ends_at > now() OR (j.customer_id IS NOT NULL AND c.ends_at > now() - interval '7 days'))
      ORDER BY c.ends_at`,
    [customerId]
  );

  const now = new Date();
  const data = await Promise.all(
    rows.map(async (row) => {
      const values = await challengeValues(row as ChallengeRow);
      const ranked = [...values.entries()].sort((a, b) => b[1] - a[1]);
      const ids = ranked.slice(0, LEADERBOARD_SIZE).map(([id]) => id);
      const { rows: names } = ids.length
        ? await pool.query(`SELECT id, name FROM pos.pos_customers WHERE id = ANY($1)`, [ids])
        : { rows: [] as Array<{ id: string; name: string | null }> };
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      return {
        ...row,
        phase: challengePhase(row, now),
        joined: row.joined_at != null,
        progress: row.joined_at != null ? challengeProgress(values.get(customerId) ?? 0, row.target) : null,
        my_rank: row.joined_at != null ? ranked.findIndex(([id]) => id === customerId) + 1 : null,
        leaderboard: ranked.slice(0, LEADERBOARD_SIZE).map(([id, value], i) => ({
          rank: i + 1,
          name: leaderboardName(nameOf.get(id) ?? null),
          value,
          is_me: id === customerId,
        })),
      };
    })
  );
  return memberJson(data);
});

const joinSchema = z.object({ challenge_id: z.string().uuid() });

/** POST — ikut challenge yang aktif dan belum berakhir. */
export const POST = withMemberSession("Gagal mengikuti challenge", async (customerId, request: Request) => {
  const parsed = joinSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Data tidak valid");
  const { rowCount } = await getPool().query(
    `INSERT INTO crm.challenge_joins (challenge_id, customer_id)
     SELECT id, $2 FROM crm.challenges WHERE id = $1 AND is_active AND ends_at > now()
     ON CONFLICT DO NOTHING`,
    [parsed.data.challenge_id, customerId]
  );
  if (!rowCount) return memberError("Challenge ini sudah berakhir atau sudah Anda ikuti", 409);
  return memberJson({ ok: true });
});
