import "server-only";
// Kategori ticket: autocomplete, auto-add dari nama, dan resolusi kategori
// saat simpan produk (anti-IDOR lintas tenant).

import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import type { TicketingContext } from "./server";

interface CategoryRow {
  id: string;
  name: string;
}

/** Daftar kategori utk autocomplete (filter q, maksimal 20). */
export function listCategories(ctx: TicketingContext, q: string) {
  const params: unknown[] = [ctx.branchId, ctx.companyId];
  let where = "branch_id = $1 AND company_id = $2";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND name ILIKE $${params.length}`;
  }
  return query<CategoryRow>(
    `SELECT id, name FROM ticketing.ticket_categories
     WHERE ${where}
     ORDER BY name
     LIMIT 20`,
    params
  );
}

const UPSERT_CATEGORY_SQL = `INSERT INTO ticketing.ticket_categories
   (company_id, branch_id, name, created_by)
 VALUES ($1, $2, $3, $4)
 ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now()
 RETURNING id, name`;

/**
 * Auto-add kategori dari autocomplete: bila nama sudah ada (case-insensitive)
 * kembalikan baris existing — submit tidak pernah gagal karena duplikat.
 */
export async function ensureCategory(
  ctx: TicketingContext,
  name: string
): Promise<{ row: CategoryRow; created: boolean }> {
  const existing = await queryOne<CategoryRow>(
    `SELECT id, name FROM ticketing.ticket_categories
     WHERE branch_id = $1 AND company_id = $2 AND lower(name) = lower($3)`,
    [ctx.branchId, ctx.companyId, name]
  );
  if (existing) return { row: existing, created: false };
  const rows = await query<CategoryRow>(UPSERT_CATEGORY_SQL, [
    ctx.companyId,
    ctx.branchId,
    name,
    ctx.user.id,
  ]);
  return { row: rows[0], created: true };
}

/**
 * Kategori untuk simpan produk: id kiriman klien WAJIB milik venue ini
 * (anti-IDOR lintas tenant); nama baru di-auto-add. `undefined` = tidak
 * diubah (PATCH).
 */
export async function resolveProductCategory(
  client: PoolClient,
  ctx: TicketingContext,
  categoryId: string | null | undefined,
  categoryName: string | null | undefined
): Promise<string | null | undefined> {
  if (categoryId) {
    const owned = await client.query(
      `SELECT 1 FROM ticketing.ticket_categories
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [categoryId, ctx.branchId, ctx.companyId]
    );
    if (owned.rows.length === 0) throw ApiError.badRequest("Kategori tidak dikenal");
    return categoryId;
  }
  if (categoryId === undefined && categoryName) {
    const created = await client.query<{ id: string }>(UPSERT_CATEGORY_SQL, [
      ctx.companyId,
      ctx.branchId,
      categoryName,
      ctx.user.id,
    ]);
    return created.rows[0].id;
  }
  return categoryId;
}
