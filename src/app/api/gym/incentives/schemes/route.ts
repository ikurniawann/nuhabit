import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { loadSchemes } from "@/lib/gym/incentive-server";
import { fail, gymStaffRoute, isUniqueViolation, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

const idr = z.number().min(0).max(100_000_000);

const schemeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  /** null = skema default organisasi. */
  coach_id: z.string().uuid().nullable(),
  session_fee_idr: idr,
  per_attendee_idr: idr,
  full_class_bonus_idr: idr,
  full_class_threshold_percent: z.number().int().min(0).max(100),
  no_show_penalty_idr: idr,
  is_active: z.boolean().default(true),
  rates: z
    .array(z.object({ class_type_id: z.string().uuid(), session_fee_idr: idr, per_attendee_idr: idr }))
    .max(50)
    .default([])
    .refine((rates) => new Set(rates.map((r) => r.class_type_id)).size === rates.length, "Satu tarif per jenis kelas"),
});

/** GET — skema (default dulu) + daftar coach dan jenis kelas untuk form. */
export const GET = gymStaffRoute(IAM.gymIncentives, "Gagal memuat skema insentif", async () => {
  const db = getPool();
  const [schemes, coaches, classTypes] = await Promise.all([
    loadSchemes(),
    db.query(`SELECT id, name, status FROM gym.coaches ORDER BY name`),
    db.query(`SELECT id, name, status FROM gym.class_types ORDER BY name`),
  ]);
  return ok({ schemes, coaches: coaches.rows, class_types: classTypes.rows });
});

/**
 * POST — buat atau ubah skema, tarif per jenis kelas diganti seluruhnya.
 * Hanya ada satu default (coach_id null) dan satu skema per coach.
 */
export const POST = gymStaffRoute(IAM.gymIncentives, "Gagal menyimpan skema insentif", async (userId, request: Request) => {
  const s = schemeSchema.parse(await request.json());
  try {
    const id = await withTransaction(async (client) => {
      const params = [
        s.name, s.coach_id, s.coach_id === null, s.session_fee_idr, s.per_attendee_idr, s.full_class_bonus_idr,
        s.full_class_threshold_percent, s.no_show_penalty_idr, s.coach_id === null ? true : s.is_active, userId,
      ];
      const { rows } = s.id
        ? await client.query<{ id: string }>(
            `UPDATE gym.incentive_schemes SET name=$1, coach_id=$2, is_default=$3, session_fee_idr=$4,
                    per_attendee_idr=$5, full_class_bonus_idr=$6, full_class_threshold_percent=$7,
                    no_show_penalty_idr=$8, is_active=$9, updated_by=$10, updated_at=now()
              WHERE id=$11 RETURNING id`,
            [...params, s.id]
          )
        : await client.query<{ id: string }>(
            `INSERT INTO gym.incentive_schemes (name, coach_id, is_default, session_fee_idr, per_attendee_idr,
                    full_class_bonus_idr, full_class_threshold_percent, no_show_penalty_idr, is_active, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            params
          );
      const schemeId = rows[0]?.id;
      if (!schemeId) return null;
      await client.query(`DELETE FROM gym.incentive_scheme_rates WHERE scheme_id = $1`, [schemeId]);
      if (s.rates.length > 0) {
        await client.query(
          `INSERT INTO gym.incentive_scheme_rates (scheme_id, class_type_id, session_fee_idr, per_attendee_idr)
           SELECT $1, r.class_type_id, r.session_fee_idr, r.per_attendee_idr
             FROM jsonb_to_recordset($2::jsonb) AS r(class_type_id uuid, session_fee_idr numeric, per_attendee_idr numeric)`,
          [schemeId, JSON.stringify(s.rates)]
        );
      }
      return schemeId;
    });
    if (!id) return fail("Skema tidak ditemukan", 404);
    return ok({ id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(s.coach_id ? "Coach ini sudah punya skema sendiri" : "Skema default sudah ada", 409);
    }
    throw error;
  }
});

/** DELETE ?id= — hapus skema khusus coach; coach kembali memakai skema default. */
export const DELETE = gymStaffRoute(IAM.gymIncentives, "Gagal menghapus skema", async (_userId, request: Request) => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const { rowCount } = await getPool().query(
    `DELETE FROM gym.incentive_schemes WHERE id = $1 AND NOT is_default`,
    [id]
  );
  if (!rowCount) return fail("Skema tidak ditemukan atau skema default (tidak bisa dihapus)", 404);
  return ok({ id });
});
