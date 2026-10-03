import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { fail, ok, schedulingRoute } from "@/lib/gym/scheduling-route";
import { coachSchema } from "@/lib/gym/scheduling-schemas";

/** GET — coach + sesi mendatang (14 hari) dan kelas yang sudah dipimpin. */
export const GET = schedulingRoute(IAM.gymScheduling, "Gagal memuat coach", async () => {
  const { rows } = await getPool().query(
    `SELECT c.*, b.name AS branch_name,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.coach_id = c.id AND s.starts_at > now() AND s.starts_at < now() + interval '14 days'
                AND s.status IN ('published', 'full')) AS upcoming_sessions,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.coach_id = c.id AND s.status = 'completed') AS completed_sessions
       FROM gym.coaches c
       LEFT JOIN configuration.branches b ON b.id = c.branch_id
      ORDER BY c.status, c.name`
  );
  return ok(rows);
});

export const POST = schedulingRoute(IAM.gymScheduling, "Gagal menyimpan coach", async (_userId, request: Request) => {
  const input = coachSchema.parse(await request.json());
  const { rows } = await getPool().query(
    `INSERT INTO gym.coaches (name, bio, specialization, photo_url, user_id, branch_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.name, input.bio, input.specialization, input.photo_url, input.user_id, input.branch_id, input.status]
  );
  if (!rows[0]) return fail("Nama coach sudah dipakai", 409);
  return ok(rows[0]);
});
