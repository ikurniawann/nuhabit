import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import {
  getPurchaseOrderIdsByModuleType,
  type PurchasingModuleType,
} from "@/lib/purchasing/module-scope";

type GrnNumberRow = { id: string; nomor_grn: string | null };

export function mapPurchaseReturnRow<
  T extends {
    grn_id?: string | null;
    grn_number?: string | null;
    grn?: { id?: string | null; nomor_grn?: string | null; grn_number?: string | null } | null;
  },
>(row: T) {
  const nomorGrn =
    row.grn_number || row.grn?.nomor_grn || row.grn?.grn_number || null;
  const grnId = row.grn_id || row.grn?.id || null;

  if (!nomorGrn && !grnId) return row;

  return {
    ...row,
    grn_number: nomorGrn,
    grn: {
      ...(row.grn || {}),
      id: grnId,
      nomor_grn: nomorGrn,
      grn_number: nomorGrn,
    },
  };
}

/** Batch-load GRN numbers when the embedded relation is missing from list queries. */
export async function enrichPurchaseReturnsWithGrn<
  T extends {
    grn_id?: string | null;
    grn?: { id?: string | null; nomor_grn?: string | null; grn_number?: string | null } | null;
  },
>(db: DbClient, rows: T[]) {
  const grnIds = [...new Set(rows.map((row) => row.grn_id).filter(Boolean))] as string[];
  if (grnIds.length === 0) {
    return rows.map((row) => mapPurchaseReturnRow(row));
  }

  const { data: grnRows, error } = await db
    .from("grn")
    .select("id, nomor_grn")
    .in("id", grnIds);

  if (error) throw error;

  const grnById = new Map(((grnRows ?? []) as GrnNumberRow[]).map((grn) => [grn.id, grn]));

  return rows.map((row) => {
    const grnFromDb = row.grn_id ? grnById.get(row.grn_id) : undefined;
    return mapPurchaseReturnRow({
      ...row,
      grn: grnFromDb
        ? {
            id: grnFromDb.id,
            nomor_grn: grnFromDb.nomor_grn,
            ...(row.grn || {}),
          }
        : row.grn,
    });
  });
}

/** GRN ids that completed QC and match the user's business scope. */
export async function listScopedQcCompletedGrnIds(
  db: DbClient,
  scope: UserScope | null,
  moduleType?: PurchasingModuleType
): Promise<string[]> {
  const { data: qcRows, error: qcError } = await db
    .from("grn_qc_inspections")
    .select("grn_id")
    .eq("inventory_posted", true);

  if (qcError) throw qcError;

  const qcGrnIds = ((qcRows ?? []) as Array<{ grn_id: string | null }>)
    .map((row) => row.grn_id)
    .filter(Boolean) as string[];
  if (qcGrnIds.length === 0) return [];

  let grnQuery = db
    .from("grn")
    .select("id")
    .in("id", qcGrnIds)
    .eq("is_active", true);

  const companyOr = companyScopeOr(scope);
  if (companyOr) grnQuery = grnQuery.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) grnQuery = grnQuery.or(branchOr);

  if (moduleType) {
    const poIds = await getPurchaseOrderIdsByModuleType(db, moduleType);
    if (poIds.length === 0) return [];
    grnQuery = grnQuery.in("purchase_order_id", poIds);
  }

  const { data: grnRows, error: grnError } = await grnQuery;
  if (grnError) throw grnError;

  return ((grnRows ?? []) as Array<{ id: string | null }>).map((row) => row.id).filter(Boolean) as string[];
}

const RETURN_SORT_COLUMNS = ["return_date", "return_number", "total_amount", "status", "created_at"];

export type ReturnListParams = {
  page: number;
  limit: number;
  status: string;
  supplierId: string | null;
  vendorId: string | null;
  reasonType: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  search: string | null;
  sortBy: string;
  sortOrder: string;
  moduleType: PurchasingModuleType;
};

/** Daftar retur pembelian, hanya untuk GRN yang sudah selesai QC dan dalam scope. */
export async function listPurchaseReturns(db: DbClient, params: ReturnListParams, scope: UserScope | null) {
  const { page, limit } = params;
  const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope, params.moduleType);
  if (scopedGrnIds.length === 0) {
    return { data: [], pagination: { page, limit, total: 0, total_pages: 0 } };
  }

  let query = db
    .from("purchase_returns")
    .select(
      `
      *,
      supplier:suppliers (
        id,
        nama_supplier
      ),
      vendor:vendors (
        id,
        name
      ),
      grn:grn (
        id,
        nomor_grn
      )
    `,
      { count: "exact" }
    )
    .in("grn_id", scopedGrnIds);

  if (params.status !== "all") query = query.eq("status", params.status);
  if (params.supplierId) query = query.eq("supplier_id", params.supplierId);
  if (params.vendorId) query = query.eq("vendor_id", params.vendorId);
  if (params.reasonType) query = query.eq("reason_type", params.reasonType);
  if (params.dateFrom) query = query.gte("return_date", params.dateFrom);
  if (params.dateTo) query = query.lte("return_date", params.dateTo);
  if (params.search) {
    const { data: matchingGrns } = await db
      .from("grn")
      .select("id")
      .ilike("nomor_grn", `%${params.search}%`);
    const grnIds = ((matchingGrns ?? []) as Array<{ id: string | null }>)
      .map((grn) => grn.id)
      .filter(Boolean);
    const textFilter = `return_number.ilike.%${params.search}%,reason_notes.ilike.%${params.search}%`;
    query = query.or(grnIds.length > 0 ? `${textFilter},grn_id.in.(${grnIds.join(",")})` : textFilter);
  }

  const sortBy = RETURN_SORT_COLUMNS.includes(params.sortBy) ? params.sortBy : "return_date";
  const from = (page - 1) * limit;
  const { data, error, count } = await query
    .order(sortBy, { ascending: params.sortOrder === "ASC" })
    .range(from, from + limit - 1);
  if (error) throw error;

  const total = count || 0;
  return {
    data: await enrichPurchaseReturnsWithGrn(db, data ?? []),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

/** Pilihan GRN untuk form retur: selesai QC, aktif, dalam scope, terbaru dulu. */
export async function listReturnableGrns(
  db: DbClient,
  scope: UserScope | null,
  moduleType: PurchasingModuleType
) {
  const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope, moduleType);
  if (scopedGrnIds.length === 0) return [];

  const { data, error } = await db
    .from("grn")
    .select(
      `
      id,
      nomor_grn,
      tanggal_penerimaan,
      supplier_id,
      vendor_id,
      supplier:suppliers (
        nama_supplier
      ),
      vendor:vendors (
        name
      )
    `
    )
    .in("id", scopedGrnIds)
    .eq("is_active", true)
    .order("tanggal_penerimaan", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
