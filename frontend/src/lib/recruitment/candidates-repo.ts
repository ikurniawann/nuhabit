import "server-only";
import type { Pool, PoolClient } from "pg";
import type { z } from "zod";
import { getPool, query, queryOne } from "@/lib/db";
import { ApiError } from "@/lib/api/auth";
import {
  buildCandidateListWhere,
  isUuid,
  type CandidateCreateData,
  type CandidateListQuery,
} from "./candidate-query";

/** Kolom kandidat + relasi bersarang `brands {name}` / `positions {title}` (bentuk lama PostgREST). */
const SELECT_WITH_REFS = `
  c.*,
  CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands,
  CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('title', p.title) END AS positions
  FROM recruitment.candidates c
  LEFT JOIN item.brands b ON b.id = c.brand_id
  LEFT JOIN hris.positions p ON p.id = c.position_id`;

/** Body JSON tervalidasi; galat zod jadi 400 dengan pesan isu pertama. */
export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Data tidak valid", parsed.error.issues);
  }
  return parsed.data;
}

export interface CandidateActor {
  id: string;
  full_name: string;
}

export async function listCandidates(q: CandidateListQuery) {
  const { where, params } = buildCandidateListWhere(q);
  const order = `ORDER BY c.${q.sort === "updated_at" ? "updated_at" : "created_at"} DESC`;
  if (q.all) {
    const rows = await query(`SELECT ${SELECT_WITH_REFS} ${where} ${order}`, params);
    return { rows, total: rows.length };
  }
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT ${SELECT_WITH_REFS} ${where} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, (q.page - 1) * q.limit]
    ),
    queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM recruitment.candidates c ${where}`,
      params
    ),
  ]);
  return { rows, total: countRow?.total ?? 0 };
}

export const getCandidate = (id: string) =>
  queryOne(`SELECT ${SELECT_WITH_REFS} WHERE c.id = $1`, [id]);

/** 400 untuk id bukan UUID, 404 bila kandidat tidak ada. */
export async function requireCandidate(id: string) {
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  const row = await queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM recruitment.candidates WHERE id = $1",
    [id]
  );
  if (!row) throw ApiError.notFound("Kandidat tidak ditemukan");
  return row;
}

const CREATE_COLUMNS = [
  "full_name",
  "email",
  "phone",
  "domicile",
  "source",
  "brand_id",
  "position_id",
  "status",
  "notes",
  "last_experience",
  "last_education",
  "availability",
  "expected_salary",
  "cv_url",
  "photo_url",
] as const;

export async function createCandidate(input: CandidateCreateData, createdBy: string | null) {
  const values = [...CREATE_COLUMNS.map((col) => input[col]), createdBy];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  return queryOne(
    `INSERT INTO recruitment.candidates (${CREATE_COLUMNS.join(", ")}, created_by)
     VALUES (${placeholders}) RETURNING *`,
    values
  );
}

/** Update sebagian kolom profil; status sengaja tidak termasuk (wajib lewat /stage). */
export async function updateCandidate(id: string, patch: Partial<CandidateCreateData>) {
  const cols = CREATE_COLUMNS.filter((col) => col !== "status" && patch[col] !== undefined);
  if (cols.length === 0) return queryOne("SELECT * FROM recruitment.candidates WHERE id = $1", [id]);
  const sets = cols.map((col, i) => `${col} = $${i + 2}`).join(", ");
  return queryOne(
    `UPDATE recruitment.candidates SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...cols.map((col) => patch[col])]
  );
}

export const listCandidateActivities = (id: string) =>
  query(
    `SELECT id, candidate_id, activity_type, description, created_by, created_by_name, created_at
       FROM recruitment.candidate_activities
      WHERE candidate_id = $1
      ORDER BY created_at DESC`,
    [id]
  );

/** Catat jejak aktivitas kandidat; `db` = client transaksi bila harus atomik. */
export async function logCandidateActivity(
  candidateId: string,
  activityType: string,
  description: string,
  actor: CandidateActor,
  db: Pool | PoolClient = getPool()
) {
  const res = await db.query(
    `INSERT INTO recruitment.candidate_activities
       (candidate_id, activity_type, description, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, candidate_id, activity_type, description, created_by, created_by_name, created_at`,
    [candidateId, activityType, description, actor.id, actor.full_name]
  );
  return res.rows[0];
}
