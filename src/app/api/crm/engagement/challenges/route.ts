import { z } from "zod";
import { getPool } from "@/lib/db";
import { engagementRoute, fail, ok } from "@/lib/crm/engagement/admin-route";
import { challengeValues, type ChallengeRow } from "@/lib/crm/engagement/server";
import { challengeProgress } from "@/lib/crm/engagement/rules";

const challengeSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(120),
    description: z.string().max(1_000).default(""),
    metric: z.enum(["visits", "spend"]),
    target: z.number().positive().max(1_000_000_000),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    reward_xp: z.number().int().min(0).max(1_000_000),
    reward_ark_idr: z.number().min(0).max(100_000_000),
    is_active: z.boolean(),
  })
  .refine((c) => new Date(c.ends_at) > new Date(c.starts_at), { message: "Selesai harus setelah mulai" });

/**
 * GET — semua challenge dengan jumlah peserta dan yang sudah selesai.
 * GET ?id= — peserta satu challenge dengan progresnya, tertinggi dulu.
 */
export const GET = engagementRoute("Gagal memuat challenge", async (request: Request) => {
  const pool = getPool();
  const id = new URL(request.url).searchParams.get("id");
  const { rows } = await pool.query(
    `SELECT c.*, c.target::float AS target, c.reward_ark_idr::float AS reward_ark_idr,
            count(j.*)::int AS participant_count,
            count(j.rewarded_at)::int AS completed_count
       FROM crm.challenges c LEFT JOIN crm.challenge_joins j ON j.challenge_id = c.id
      WHERE ($1::uuid IS NULL OR c.id = $1)
      GROUP BY c.id ORDER BY c.ends_at DESC`,
    [id && z.string().uuid().safeParse(id).success ? id : null]
  );
  if (!id) return ok(rows);

  const challenge = rows[0] as ChallengeRow | undefined;
  if (!challenge) return fail("Challenge tidak ditemukan", 404);
  const values = await challengeValues(challenge);
  const { rows: people } = await pool.query(
    `SELECT j.customer_id, j.joined_at, j.rewarded_at, c.name, c.phone
       FROM crm.challenge_joins j JOIN pos.pos_customers c ON c.id = j.customer_id
      WHERE j.challenge_id = $1`,
    [challenge.id]
  );
  const participants = people
    .map((p) => ({ ...p, ...challengeProgress(values.get(p.customer_id) ?? 0, Number(challenge.target)) }))
    .sort((a, b) => b.value - a.value);
  return ok({ challenge, participants });
});

/** POST — buat atau ubah challenge. */
export const POST = engagementRoute("Gagal menyimpan challenge", async (request: Request) => {
  const c = challengeSchema.parse(await request.json());
  const params = [
    c.title, c.description, c.metric, c.target, c.starts_at, c.ends_at, c.reward_xp, c.reward_ark_idr, c.is_active,
  ];
  const { rows } = c.id
    ? await getPool().query(
        `UPDATE crm.challenges SET title=$1, description=$2, metric=$3, target=$4, starts_at=$5, ends_at=$6,
                reward_xp=$7, reward_ark_idr=$8, is_active=$9, updated_at=now()
          WHERE id=$10 RETURNING id`,
        [...params, c.id]
      )
    : await getPool().query(
        `INSERT INTO crm.challenges (title, description, metric, target, starts_at, ends_at, reward_xp,
                                     reward_ark_idr, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        params
      );
  if (!rows[0]) return fail("Challenge tidak ditemukan", 404);
  return ok(rows[0]);
});
