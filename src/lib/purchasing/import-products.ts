/**
 * Impor produk (POST /api/purchasing/import/products). Scope company/branch
 * diambil dari stall/gudang tiap baris; kode yang sudah ada di stall itu di-update.
 */
import { validateProductWarehouseScope, type UserScope } from "@/lib/api/scope";
import { queryOne } from "@/lib/db";
import type { DbClient } from "@/lib/pg/types";
import { exactScope, resolveWarehouseIdByCode } from "@/lib/purchasing/import-lookups";
import {
  emptyToNull,
  ImportTally,
  isBlankRow,
  nextCodeSequence,
  parseActiveCell,
  parseNumberCell,
  type ImportRow,
} from "@/lib/purchasing/import-spreadsheet";

const PRODUCT_FIELD_KEYS = [
  "kode",
  "nama",
  "stall_code",
  "kategori",
  "satuan_kode",
  "deskripsi",
  "harga_jual",
  "harga_modal",
  "markup_persen",
  "production_output_type",
  "status",
] as const;

export function normalizeOutputType(value: string | undefined): "FINISHED_GOOD" | "WIP" {
  const raw = value?.trim().toUpperCase().replace(/\s+/g, "_");
  return raw === "WIP" || raw === "WORK_IN_PROGRESS" ? "WIP" : "FINISHED_GOOD";
}

/** Kolom produk dari satu baris file (header sudah lewat alias product-spreadsheet). */
export function buildProductPayload(data: Record<string, string>, satuanId: string) {
  return {
    nama: data.nama.trim(),
    kategori: emptyToNull(data.kategori)?.toUpperCase() ?? null,
    satuan_id: satuanId,
    deskripsi: emptyToNull(data.deskripsi),
    harga_jual: parseNumberCell(data.harga_jual, 0),
    harga_modal: parseNumberCell(data.harga_modal, 0),
    markup_persen: parseNumberCell(data.markup_persen, 30),
    production_output_type: normalizeOutputType(data.production_output_type),
    is_active: parseActiveCell(data.status),
  };
}

type Context = {
  db: DbClient;
  userId: string;
  unitCache: Map<string, string | null>;
  warehouseCache: Map<string, string | null>;
  categoryCache: Map<string, boolean>;
};

/** Dengan company: hanya satuan milik company itu. Tanpa company: satuan apa pun, global dulu. */
async function resolveUnitId(code: string, companyId: string | null, ctx: Context): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  const cacheKey = `${companyId || "*"}:${normalized}`;
  if (!ctx.unitCache.has(cacheKey)) {
    const row = await queryOne<{ id: string }>(
      companyId
        ? `SELECT id FROM item.units
           WHERE deleted_at IS NULL AND upper(kode) = upper($1) AND company_id = $2
           LIMIT 1`
        : `SELECT id FROM item.units
           WHERE deleted_at IS NULL AND upper(kode) = upper($1)
           ORDER BY company_id NULLS LAST
           LIMIT 1`,
      companyId ? [normalized, companyId] : [normalized]
    );
    ctx.unitCache.set(cacheKey, row?.id ?? null);
  }
  return ctx.unitCache.get(cacheKey) ?? null;
}

/** Kategori global atau milik company; tanpa company hanya kategori global. */
async function isValidCategory(code: string, companyId: string | null, ctx: Context): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const cacheKey = `${companyId || "*"}:${normalized}`;
  if (!ctx.categoryCache.has(cacheKey)) {
    const row = await queryOne<{ code: string }>(
      `SELECT code FROM item.product_categories
       WHERE deleted_at IS NULL
         AND upper(code) = upper($1)
         AND ${companyId ? "(company_id IS NULL OR company_id = $2)" : "company_id IS NULL"}
       LIMIT 1`,
      companyId ? [normalized, companyId] : [normalized]
    );
    ctx.categoryCache.set(cacheKey, Boolean(row?.code));
  }
  return ctx.categoryCache.get(cacheKey) ?? false;
}

/** PRD-YYYYMMDD-### berikutnya untuk stall + company/branch ini. */
async function generateProductCode(
  ctx: Context,
  companyId: string | null,
  branchId: string | null,
  warehouseId: string
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const query = ctx.db
    .from("products")
    .select("kode")
    .like("kode", `PRD-${date}-%`)
    .eq("warehouse_id", warehouseId)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1);
  const { data } = await exactScope(query, companyId, branchId);
  const last = Array.isArray(data) ? (data[0]?.kode as string | undefined) : undefined;
  return `PRD-${date}-${String(nextCodeSequence(last)).padStart(3, "0")}`;
}

/** Baris valid → id referensinya; string = pesan galat baris. */
async function resolveRow(row: ImportRow, scope: UserScope | null, branchFilter: string | null, ctx: Context) {
  const { data } = row;
  if (!data.nama?.trim()) return "Required field missing: nama";

  const stallCode = data.stall_code?.trim() || "";
  if (!stallCode) return "Required field missing: stall_code";

  const warehouseId = await resolveWarehouseIdByCode(ctx.db, stallCode, branchFilter, ctx.warehouseCache);
  if (!warehouseId) return `Stall code not found: ${stallCode}`;

  const warehouseScope = await validateProductWarehouseScope(warehouseId, scope);
  if ("error" in warehouseScope) return warehouseScope.error;
  const { company_id: companyId, branch_id: branchId } = warehouseScope;

  const satuanKode = data.satuan_kode?.trim() || "";
  if (!satuanKode) return "Required field missing: satuan_kode";

  const satuanId = await resolveUnitId(satuanKode, companyId, ctx);
  if (!satuanId) return `Unit code not found: ${satuanKode}`;

  const kategori = data.kategori?.trim();
  if (kategori && !(await isValidCategory(kategori, companyId, ctx))) {
    return `Category code not found: ${kategori}`;
  }
  return { warehouseId, companyId, branchId, satuanId };
}

export async function importProducts(
  db: DbClient,
  rows: ImportRow[],
  params: { userId: string; scope: UserScope | null; branchFilter: string | null }
) {
  const ctx: Context = {
    db,
    userId: params.userId,
    unitCache: new Map(),
    warehouseCache: new Map(),
    categoryCache: new Map(),
  };
  const tally = new ImportTally();

  for (const row of rows) {
    if (isBlankRow(row.data, PRODUCT_FIELD_KEYS)) continue;

    const refs = await resolveRow(row, params.scope, params.branchFilter, ctx);
    if (typeof refs === "string") {
      tally.skip(row.rowNumber, refs);
      continue;
    }
    const { warehouseId, companyId, branchId, satuanId } = refs;

    const kode =
      row.data.kode?.trim() || (await generateProductCode(ctx, companyId, branchId, warehouseId));
    const existingQuery = db
      .from("products")
      .select("id")
      .eq("kode", kode)
      .eq("warehouse_id", warehouseId)
      .is("deleted_at", null);
    const { data: existing } = await exactScope(existingQuery, companyId, branchId).maybeSingle();
    const payload = buildProductPayload(row.data, satuanId);

    const { error } = existing?.id
      ? await db
          .from("products")
          .update({
            ...payload,
            warehouse_id: warehouseId,
            company_id: companyId,
            branch_id: branchId,
            updated_by: params.userId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
      : await db.from("products").insert({
          kode,
          company_id: companyId,
          branch_id: branchId,
          warehouse_id: warehouseId,
          ...payload,
          created_by: params.userId,
        });

    if (error) tally.skip(row.rowNumber, error.message);
    else if (existing?.id) tally.updated += 1;
    else tally.imported += 1;
  }

  return tally.summary();
}
