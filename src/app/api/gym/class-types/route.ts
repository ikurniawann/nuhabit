import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { fail, ok, schedulingRoute } from "@/lib/gym/scheduling-route";
import { classTypeSchema } from "@/lib/gym/scheduling-schemas";

/** GET — semua jenis kelas + jumlah sesi mendatang. */
export const GET = schedulingRoute(IAM.gymScheduling, "Gagal memuat jenis kelas", async () => {
  const { rows } = await getPool().query(
    `SELECT t.*,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.class_type_id = t.id AND s.starts_at > now() AND s.status IN ('draft', 'published', 'full'))
              AS upcoming_sessions
       FROM gym.class_types t
      ORDER BY t.status, t.name`
  );
  return ok(rows);
});

/** POST — jenis kelas baru (template untuk sesi). */
export const POST = schedulingRoute(IAM.gymScheduling, "Gagal menyimpan jenis kelas", async (_userId, request: Request) => {
  const input = classTypeSchema.parse(await request.json());
  const { rows } = await getPool().query(
    `INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.name, input.description, input.default_duration_min, input.default_credit_cost, input.default_capacity,
      input.color, input.status]
  );
  if (!rows[0]) return fail("Nama jenis kelas sudah dipakai", 409);
  return ok(rows[0]);
});
