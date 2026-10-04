import "server-only";
/** Master jadwal untuk admin: jenis kelas (template sesi) dan coach. */
import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import type { classTypeSchema, coachSchema } from "./scheduling-schemas";
import { isUniqueViolation } from "./staff-route";

export type ClassTypeInput = z.infer<typeof classTypeSchema>;
export type CoachInput = z.infer<typeof coachSchema>;

/* ── Jenis kelas ─────────────────────────────────────────────────────── */

/** Semua jenis kelas + jumlah sesi mendatang. */
export async function listClassTypes() {
  const { rows } = await getPool().query(
    `SELECT t.*,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.class_type_id = t.id AND s.starts_at > now() AND s.status IN ('draft', 'published', 'full'))
              AS upcoming_sessions
       FROM gym.class_types t
      ORDER BY t.status, t.name`
  );
  return rows;
}

export async function createClassType(input: ClassTypeInput): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      input.name,
      input.description,
      input.default_duration_min,
      input.default_credit_cost,
      input.default_capacity,
      input.color,
      input.status,
    ]
  );
  if (!rows[0]) throw ApiError.conflict("Nama jenis kelas sudah dipakai");
  return rows[0];
}

/** Ubah template. Sesi yang sudah dibuat tidak ikut berubah. */
export async function updateClassType(id: string, input: Partial<ClassTypeInput>): Promise<{ id: string }> {
  const { rows } = await getPool()
    .query<{ id: string }>(
      `UPDATE gym.class_types SET
          name = COALESCE($2, name), description = COALESCE($3, description),
          default_duration_min = COALESCE($4, default_duration_min),
          default_credit_cost = COALESCE($5, default_credit_cost),
          default_capacity = COALESCE($6, default_capacity),
          color = COALESCE($7, color), status = COALESCE($8, status), updated_at = now()
        WHERE id = $1 RETURNING id`,
      [
        id,
        input.name,
        input.description,
        input.default_duration_min,
        input.default_credit_cost,
        input.default_capacity,
        input.color,
        input.status,
      ]
    )
    .catch((error) => {
      if (isUniqueViolation(error)) throw ApiError.conflict("Nama jenis kelas sudah dipakai");
      throw error;
    });
  if (!rows[0]) throw ApiError.notFound("Jenis kelas tidak ditemukan");
  return rows[0];
}

/** Arsipkan (sesi lama tetap merujuk ke template ini). */
export async function archiveClassType(id: string): Promise<void> {
  const { rowCount } = await getPool().query(
    `UPDATE gym.class_types SET status = 'archived', updated_at = now() WHERE id = $1`,
    [id]
  );
  if (!rowCount) throw ApiError.notFound("Jenis kelas tidak ditemukan");
}

/* ── Coach ───────────────────────────────────────────────────────────── */

/** Coach + sesi mendatang (14 hari) dan kelas yang sudah dipimpin. */
export async function listCoaches() {
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
  return rows;
}

export async function createCoach(input: CoachInput): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO gym.coaches (name, bio, specialization, photo_url, user_id, branch_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.name, input.bio, input.specialization, input.photo_url, input.user_id, input.branch_id, input.status]
  );
  if (!rows[0]) throw ApiError.conflict("Nama coach sudah dipakai");
  return rows[0];
}

/**
 * Ubah profil atau nonaktifkan coach. Kolom yang tidak dikirim tetap;
 * photo_url dan branch_id boleh dikosongkan, jadi `sent` menandai yang dikirim.
 */
export async function updateCoach(
  id: string,
  input: Partial<CoachInput>,
  sent: { photoUrl: boolean; branchId: boolean }
): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `UPDATE gym.coaches SET
        name = COALESCE($2, name), bio = COALESCE($3, bio), specialization = COALESCE($4, specialization),
        photo_url = CASE WHEN $8 THEN $5 ELSE photo_url END,
        branch_id = CASE WHEN $9 THEN $6 ELSE branch_id END,
        status = COALESCE($7, status), updated_at = now()
      WHERE id = $1 RETURNING id`,
    [
      id,
      input.name,
      input.bio,
      input.specialization,
      input.photo_url ?? null,
      input.branch_id ?? null,
      input.status,
      sent.photoUrl,
      sent.branchId,
    ]
  );
  if (!rows[0]) throw ApiError.notFound("Coach tidak ditemukan");
  return rows[0];
}
