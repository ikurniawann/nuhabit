import "server-only";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { ApiError } from "@/lib/api/auth";

/** Master data HRIS: departemen, jabatan (positions), status kepegawaian. */

const optionalText = z
  .string()
  .nullish()
  .transform((v) => v || null);

const required = (message: string) => z.string(message).trim().min(1, message);

export const departmentSchema = z.object({
  name: required("Nama dan kode wajib diisi"),
  code: required("Nama dan kode wajib diisi").transform((v) => v.toUpperCase()),
  description: optionalText,
  is_active: z.boolean().optional(),
});

export const employmentStatusSchema = z.object({
  code: required("Kode dan nama wajib diisi").transform((v) => v.toLowerCase()),
  name: required("Kode dan nama wajib diisi"),
  color: optionalText,
  description: optionalText,
  is_active: z.boolean().optional(),
});

export const positionSchema = z.object({
  title: required("Nama jabatan wajib diisi"),
  department: optionalText,
  level: optionalText,
  is_active: z.boolean().optional(),
  brand_id: z.string().uuid().nullish().or(z.literal("")).transform((v) => v || null),
});

type Department = z.infer<typeof departmentSchema>;
type EmploymentStatus = z.infer<typeof employmentStatusSchema>;
type Position = z.infer<typeof positionSchema>;

/** Kode unik bentrok → 400 berpesan spesifik (bukan 409 generik). */
async function withUniqueMessage<T>(run: () => Promise<T>, message: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw ApiError.badRequest(message);
    throw error;
  }
}

function found<T>(row: T | null, message: string): T {
  if (!row) throw ApiError.notFound(message);
  return row;
}

/** Tolak hapus master yang masih dipakai karyawan. */
async function assertUnused(column: string, value: string, what: string) {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM hris.employees WHERE ${column} = $1`,
    [value]
  );
  if (row && row.n > 0) throw ApiError.badRequest(`Tidak dapat dihapus, masih ada ${row.n} karyawan ${what}`);
}

// ── Departemen ────────────────────────────────────────────────────────────

const DEPARTMENT_FIELDS = "id, name, code, description, is_active, created_at, updated_at";
const DUP_DEPARTMENT = "Kode departemen sudah digunakan";

export const listDepartments = () =>
  query(`SELECT ${DEPARTMENT_FIELDS} FROM hris.departments ORDER BY name`);

export const createDepartment = (d: Department) =>
  withUniqueMessage(
    () =>
      queryOne(
        `INSERT INTO hris.departments (name, code, description, is_active)
         VALUES ($1, $2, $3, COALESCE($4, true)) RETURNING ${DEPARTMENT_FIELDS}`,
        [d.name, d.code, d.description, d.is_active ?? null]
      ),
    DUP_DEPARTMENT
  );

export const updateDepartment = async (id: string, d: Department) =>
  found(
    await withUniqueMessage(
      () =>
        queryOne(
          `UPDATE hris.departments
              SET name = $2, code = $3, description = $4, is_active = COALESCE($5, is_active), updated_at = now()
            WHERE id = $1 RETURNING ${DEPARTMENT_FIELDS}`,
          [id, d.name, d.code, d.description, d.is_active ?? null]
        ),
      DUP_DEPARTMENT
    ),
    "Departemen tidak ditemukan"
  );

export async function deleteDepartment(id: string) {
  await assertUnused("department_id", id, "di departemen ini");
  await query("DELETE FROM hris.departments WHERE id = $1", [id]);
}

// ── Status kepegawaian ────────────────────────────────────────────────────

const STATUS_FIELDS = "id, code, name, color, description, is_active, created_at, updated_at";
const DUP_STATUS = "Kode status sudah digunakan";

export const listEmploymentStatuses = () =>
  query(`SELECT ${STATUS_FIELDS} FROM hris.employment_statuses ORDER BY name`);

export const createEmploymentStatus = (s: EmploymentStatus) =>
  withUniqueMessage(
    () =>
      queryOne(
        `INSERT INTO hris.employment_statuses (code, name, color, description, is_active)
         VALUES ($1, $2, COALESCE($3, 'gray'), $4, COALESCE($5, true)) RETURNING ${STATUS_FIELDS}`,
        [s.code, s.name, s.color, s.description, s.is_active ?? null]
      ),
    DUP_STATUS
  );

export const updateEmploymentStatus = async (id: string, s: EmploymentStatus) =>
  found(
    await withUniqueMessage(
      () =>
        queryOne(
          `UPDATE hris.employment_statuses
              SET code = $2, name = $3, color = COALESCE($4, 'gray'), description = $5,
                  is_active = COALESCE($6, is_active), updated_at = now()
            WHERE id = $1 RETURNING ${STATUS_FIELDS}`,
          [id, s.code, s.name, s.color, s.description, s.is_active ?? null]
        ),
      DUP_STATUS
    ),
    "Status kepegawaian tidak ditemukan"
  );

export async function deleteEmploymentStatus(id: string) {
  const status = await queryOne<{ code: string }>("SELECT code FROM hris.employment_statuses WHERE id = $1", [id]);
  if (status) await assertUnused("employment_status", status.code, "dengan status ini");
  await query("DELETE FROM hris.employment_statuses WHERE id = $1", [id]);
}

// ── Jabatan ───────────────────────────────────────────────────────────────

const POSITION_SELECT = `SELECT p.*,
    CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands
  FROM hris.positions p LEFT JOIN item.brands b ON b.id = p.brand_id`;

export const listPositions = (brandId?: string | null) =>
  query(`${POSITION_SELECT} WHERE $1::uuid IS NULL OR p.brand_id = $1 ORDER BY p.title`, [brandId ?? null]);

const getPosition = (id: string) => queryOne(`${POSITION_SELECT} WHERE p.id = $1`, [id]);

export async function createPosition(p: Position) {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO hris.positions (title, department, level, is_active, brand_id)
     VALUES ($1, COALESCE($2, 'Operations'), COALESCE($3, 'Staff'), COALESCE($4, true), $5) RETURNING id`,
    [p.title, p.department, p.level, p.is_active ?? null, p.brand_id]
  );
  return row && getPosition(row.id);
}

export async function updatePosition(id: string, p: Position) {
  const row = await queryOne<{ id: string }>(
    `UPDATE hris.positions
        SET title = $2, department = COALESCE($3, 'Operations'), level = COALESCE($4, 'Staff'),
            is_active = COALESCE($5, is_active), brand_id = $6
      WHERE id = $1 RETURNING id`,
    [id, p.title, p.department, p.level, p.is_active ?? null, p.brand_id]
  );
  return found(row && (await getPosition(row.id)), "Jabatan tidak ditemukan");
}

export async function deletePosition(id: string) {
  await assertUnused("job_title_id", id, "dengan jabatan ini");
  await query("DELETE FROM hris.positions WHERE id = $1", [id]);
}
