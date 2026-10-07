/** Bagian server impor master purchasing: baca file unggahan dan cari gudang per kode. */
import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { matrixToRows, parseSpreadsheetMatrix, type ImportRow } from "@/lib/purchasing/import-spreadsheet";

/** Field `file` (CSV/XLSX) dari form-data → baris ber-key header. */
export async function readUploadedSheet(
  request: Request,
  normalizeHeader: (header: string) => string
): Promise<ImportRow[]> {
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File not found");

  const matrix = await parseSpreadsheetMatrix(Buffer.from(await file.arrayBuffer()), file.name);
  if (matrix.length < 2) {
    throw ApiError.badRequest("File must include a header row and at least one data row");
  }
  return matrixToRows(matrix, normalizeHeader);
}

/** Gudang/stall aktif per kode (case-insensitive), dibatasi cabang bila ada. Hasil di-cache. */
export async function resolveWarehouseIdByCode(
  db: DbClient,
  code: string,
  branchId: string | null,
  cache: Map<string, string | null>
): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  const cacheKey = `${branchId || "global"}:${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  let query = db
    .from("warehouses", "configuration")
    .select("id")
    .ilike("code", normalized)
    .eq("is_active", true);
  if (branchId) query = query.eq("branch_id", branchId);

  const { data } = await query.maybeSingle();
  const id = (data?.id as string | undefined) ?? null;
  cache.set(cacheKey, id);
  return id;
}

/** Filter company/branch persis (NULL bila tidak ada) untuk cek kode yang sudah ada. */
export function exactScope<Q extends { eq(col: string, v: unknown): Q; is(col: string, v: unknown): Q }>(
  query: Q,
  companyId: string | null,
  branchId: string | null
): Q {
  const withCompany = companyId ? query.eq("company_id", companyId) : query.is("company_id", null);
  return branchId ? withCompany.eq("branch_id", branchId) : withCompany.is("branch_id", null);
}
