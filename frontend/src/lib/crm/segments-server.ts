import "server-only";
/**
 * EPIC-050 Fase 5 — sisi server segmen: CRUD segmen tersimpan, eksekusi
 * pratinjau, dan pemuatan segmen untuk dipakai kampanye.
 */
import { ApiError, type ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { scopedCompanyId } from "./guards";
import {
  buildSegmentQuery,
  segmentDefinitionSchema,
  type SegmentDefinition,
  type SegmentInput,
  type SegmentSource,
} from "./segments";

export interface SegmentRow {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  source: SegmentSource;
  definition: unknown;
  is_active: boolean;
  last_count: number | null;
  last_counted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function loadAccessibleSegment(
  id: string,
  scope: UserScope | null
): Promise<SegmentRow | null> {
  const params: unknown[] = [id];
  let where = "s.id = $1 AND s.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (s.company_id IS NULL OR s.company_id = $${params.length})`;
  }
  return queryOne<SegmentRow>(
    `SELECT s.id, s.company_id, s.name, s.description, s.source, s.definition, s.is_active,
            s.last_count, s.last_counted_at, s.created_by, s.created_at, s.updated_at
     FROM crm.crm_segments s WHERE ${where}`,
    params
  );
}

/** Segmen di scope company user; 404 bila tidak ada. */
export async function requireSegment(id: string, scope: UserScope | null): Promise<SegmentRow> {
  const row = await loadAccessibleSegment(id, scope);
  if (!row) throw ApiError.notFound("Segmen tidak ditemukan");
  return row;
}

export function listSegments(scope: UserScope | null) {
  const params: unknown[] = [];
  let where = "s.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (s.company_id IS NULL OR s.company_id = $${params.length})`;
  }
  return query(
    `SELECT s.id, s.company_id, s.name, s.description, s.source, s.definition, s.is_active,
            s.last_count, s.last_counted_at, s.created_by, s.created_at, s.updated_at,
            u.full_name AS creator_name
     FROM crm.crm_segments s
     LEFT JOIN configuration.users u ON u.id = s.created_by
     WHERE ${where}
     ORDER BY s.is_active DESC, s.updated_at DESC`,
    params
  );
}

export function createSegment(user: ApiUser, scope: UserScope | null, b: SegmentInput) {
  return queryOne(
    `INSERT INTO crm.crm_segments (company_id, name, description, source, definition, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, name, source, is_active`,
    [scopedCompanyId(user, scope), b.name, b.description ?? null, b.definition.source, JSON.stringify(b.definition), b.is_active, user.id]
  );
}

export function updateSegment(id: string, b: Partial<SegmentInput>) {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.description !== undefined) push("description", b.description ?? null);
  if (b.is_active !== undefined) push("is_active", b.is_active);
  if (b.definition !== undefined) {
    push("definition", JSON.stringify(b.definition), "::jsonb");
    push("source", b.definition.source);
    // Definisi berubah → jumlah tersimpan tidak lagi berlaku.
    sets.push("last_count = NULL", "last_counted_at = NULL");
  }
  if (values.length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
  values.push(id);
  return queryOne(
    `UPDATE crm.crm_segments SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL
     RETURNING id, name, source, is_active`,
    values
  );
}

/** Hapus lunak; 409 bila segmen masih dipakai kampanye yang belum selesai. */
export async function deleteSegment(id: string): Promise<void> {
  const used = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_campaigns WHERE segment_id = $1 AND status IN ('draft', 'sending', 'paused') LIMIT 1`,
    [id]
  );
  if (used) throw ApiError.conflict("Segmen masih dipakai kampanye yang berjalan");
  await query(`UPDATE crm.crm_segments SET deleted_at = now(), is_active = false WHERE id = $1`, [id]);
}

/** Definisi tersimpan → objek tervalidasi; baris rusak tidak menjatuhkan API. */
export function parseStoredSegment(source: SegmentSource, raw: unknown): SegmentDefinition {
  const parsed = segmentDefinitionSchema.safeParse({ ...(raw && typeof raw === "object" ? raw : {}), source });
  return parsed.success ? parsed.data : segmentDefinitionSchema.parse({ source });
}

export interface SegmentPreviewResult {
  total: number;
  sample: Array<{ id: string; name: string; phone: string | null; r_score?: number; f_score?: number; m_score?: number; total_spent?: string | number; visit_count?: number }>;
  with_rfm: boolean;
}

/** Jumlah anggota + contoh baris. Dipakai pratinjau builder dan kartu kampanye. */
export async function previewSegment(
  def: SegmentDefinition,
  scope: UserScope | null,
  sampleSize = 10
): Promise<SegmentPreviewResult> {
  const companyId = scope?.companyId ?? null;
  const counted = buildSegmentQuery(def, { companyId, countOnly: true });
  const countRow = await queryOne<{ total: number }>(counted.sql, counted.params);
  const listed = buildSegmentQuery({ ...def, limit: Math.min(def.limit, sampleSize) }, { companyId });
  const sample = await query<SegmentPreviewResult["sample"][number]>(listed.sql, listed.params);
  return { total: Number(countRow?.total ?? 0), sample, with_rfm: listed.withRfm };
}

/** Simpan hasil hitung terakhir supaya daftar segmen ringan. */
export async function rememberSegmentCount(id: string, total: number): Promise<void> {
  await query(
    `UPDATE crm.crm_segments SET last_count = $2, last_counted_at = now(), updated_at = now() WHERE id = $1`,
    [id, total]
  );
}
