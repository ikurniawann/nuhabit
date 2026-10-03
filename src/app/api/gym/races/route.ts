import { z } from "zod";
import { getPool } from "@/lib/db";
import { RACE_REGIONS, RACE_STATUSES } from "@/lib/gym/races";
import { fail, gymStaffRoute, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

const raceSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(3).max(120),
    country: z.string().trim().min(2).max(80),
    region: z.enum(RACE_REGIONS),
    city: z.string().trim().min(2).max(80),
    venue: z.string().trim().max(160).default(""),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    registration_url: z.string().trim().max(500).default(""),
    image_url: z.string().trim().url().max(500).nullable().default(null),
    status: z.enum(RACE_STATUSES),
  })
  .refine((r) => new Date(r.ends_at) >= new Date(r.starts_at), { message: "Selesai harus setelah mulai", path: ["ends_at"] });

/** GET — semua race, yang mendatang dulu, dengan jumlah peserta member. */
export const GET = gymStaffRoute(IAM.gymRaces, "Gagal memuat race", async () => {
  const { rows } = await getPool().query(
    `SELECT e.*,
            count(r.*) FILTER (WHERE r.status = 'training')::int AS training_count,
            count(r.*) FILTER (WHERE r.status = 'raced')::int AS raced_count
       FROM gym.race_events e LEFT JOIN gym.member_races r ON r.race_event_id = e.id
      GROUP BY e.id
      ORDER BY (e.ends_at < now()), e.starts_at`
  );
  return ok(rows);
});

/** POST — buat atau ubah race. */
export const POST = gymStaffRoute(IAM.gymRaces, "Gagal menyimpan race", async (_userId, request: Request) => {
  const r = raceSchema.parse(await request.json());
  const params = [
    r.name, r.country, r.region, r.city, r.venue, r.starts_at, r.ends_at, r.registration_url, r.image_url, r.status,
  ];
  const { rows } = r.id
    ? await getPool().query(
        `UPDATE gym.race_events SET name=$1, country=$2, region=$3, city=$4, venue=$5, starts_at=$6, ends_at=$7,
                registration_url=$8, image_url=$9, status=$10, updated_at=now()
          WHERE id=$11 RETURNING id`,
        [...params, r.id]
      )
    : await getPool().query(
        `INSERT INTO gym.race_events (name, country, region, city, venue, starts_at, ends_at, registration_url, image_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        params
      );
  if (!rows[0]) return fail("Race tidak ditemukan", 404);
  return ok(rows[0]);
});

/**
 * DELETE ?id= — race tanpa peserta dihapus; race yang sudah punya peserta
 * hanya dibatalkan supaya riwayat member tetap ada.
 */
export const DELETE = gymStaffRoute(IAM.gymRaces, "Gagal menghapus race", async (_userId, request: Request) => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const { rows } = await getPool().query<{ outcome: "deleted" | "cancelled" }>(
    `WITH entrants AS (SELECT count(*) AS n FROM gym.member_races WHERE race_event_id = $1),
          removed AS (
            DELETE FROM gym.race_events WHERE id = $1 AND (SELECT n FROM entrants) = 0 RETURNING 'deleted'::text AS outcome
          ),
          cancelled AS (
            UPDATE gym.race_events SET status = 'cancelled', updated_at = now()
             WHERE id = $1 AND (SELECT n FROM entrants) > 0 RETURNING 'cancelled'::text AS outcome
          )
     SELECT outcome FROM removed UNION ALL SELECT outcome FROM cancelled`,
    [id]
  );
  if (!rows[0]) return fail("Race tidak ditemukan", 404);
  return ok({ id, outcome: rows[0].outcome });
});
