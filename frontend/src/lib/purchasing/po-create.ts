import { ApiError } from "@/lib/api/auth";
import { effectiveBranchId, effectiveCompanyId, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { computePoTotals, sumPoLines } from "@/lib/purchasing/po-totals";
import {
  generalPoCreateSchema,
  productPoCreateSchema,
  rawMaterialPoCreateSchema,
  type PoCreateInput,
  type PoCreateLine,
} from "@/lib/purchasing/po-schemas";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  validatePoLinesAgainstSkus,
  type SkuOwnershipRow,
} from "@/lib/purchasing/variant-po-lines";

export function parsePoCreateBody(body: unknown, moduleType: PurchasingModuleType): PoCreateInput {
  if (moduleType === "product") return parseBodyOrThrow(productPoCreateSchema, body);
  if (moduleType === "general") return parseBodyOrThrow(generalPoCreateSchema, body);
  return parseBodyOrThrow(rawMaterialPoCreateSchema, body);
}

/** Nomor PO bulanan: PO-YYYYMM-NNNN (berbeda dari nomor harian konversi PR). */
export function nextMonthlyPoNumber(prefix: string, lastNumber: string | null | undefined): string {
  const last = lastNumber ? parseInt(lastNumber.split("-").pop() || "0") : 0;
  return `${prefix}-${String(last + 1).padStart(4, "0")}`;
}

async function generateMonthlyPoNumber(db: DbClient, today = new Date()): Promise<string> {
  const prefix = `PO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}`;
  const { data, error } = await db
    .from("purchase_orders")
    .select("nomor_po")
    .ilike("nomor_po", `${prefix}-%`)
    .order("nomor_po", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ nomor_po: string }>;
  return nextMonthlyPoNumber(prefix, rows[0]?.nomor_po);
}

type BusinessIds = { companyId: string | null; branchId: string | null };

/**
 * company/branch PO: scope user → PR asal (wajib approved & belum dikonversi)
 * → pemasok (vendor/supplier) → scope user lagi sebagai cadangan terakhir.
 */
async function resolvePoBusinessIds(
  db: DbClient,
  input: PoCreateInput,
  scope: UserScope | null
): Promise<BusinessIds> {
  let companyId = effectiveCompanyId(scope);
  let branchId = effectiveBranchId(scope);

  if (input.pr_id) {
    const { data: linkedPr } = await db
      .from("purchase_requests")
      .select("id, status, converted_po_id, company_id, branch_id")
      .eq("id", input.pr_id)
      .maybeSingle();

    if (!linkedPr) throw ApiError.notFound("PR tidak ditemukan");
    if (linkedPr.status !== "approved") {
      throw ApiError.badRequest("PR harus approved sebelum dibuatkan PO");
    }
    if (linkedPr.converted_po_id) throw ApiError.badRequest("PR sudah dibuatkan PO");

    companyId = linkedPr.company_id ?? companyId;
    branchId = linkedPr.branch_id ?? branchId;
  }

  if (companyId && branchId) return { companyId, branchId };

  const party =
    "vendor_id" in input
      ? { table: "vendors", id: input.vendor_id }
      : { table: "suppliers", id: input.supplier_id };
  const { data: partyRow, error } = await db
    .from(party.table)
    .select("company_id, branch_id")
    .eq("id", party.id)
    .maybeSingle();
  if (error) throw error;

  return {
    companyId: companyId ?? partyRow?.company_id ?? scope?.companyId ?? null,
    branchId:
      branchId ??
      partyRow?.branch_id ??
      (scope?.businessScope === "branch" ? scope.branchId : null) ??
      null,
  };
}

type PosProductRow = { id: string; source_product_id: string };
type PosSkuRow = { id: string; product_id: string; is_active: boolean };

/** Petakan SKU POS ke produk item pemiliknya; produk dengan SKU aktif = ber-varian. */
export function mapSkuOwnership(posProducts: PosProductRow[], skuRows: PosSkuRow[]) {
  const sourceByPosProduct = new Map(posProducts.map((p) => [p.id, p.source_product_id]));
  const rows: SkuOwnershipRow[] = skuRows.map((row) => ({
    id: row.id,
    source_product_id: sourceByPosProduct.get(row.product_id) ?? "",
    is_active: Boolean(row.is_active),
  }));
  const variantProductIds = new Set(
    rows.filter((row) => row.is_active).map((row) => row.source_product_id)
  );
  return { rows, variantProductIds };
}

/**
 * EPIC-047 Fase 2 — baris PO produk ber-varian wajib memilih SKU milik produk
 * itu. Divalidasi SEBELUM insert apa pun supaya 400 tidak meninggalkan PO yatim.
 */
async function assertProductSkuLines(
  db: DbClient,
  items: Array<{ product_id: string; pos_sku_id?: string | null }>
) {
  const productIds = Array.from(new Set(items.map((item) => item.product_id)));
  const { data: posProducts, error: posProductsError } = productIds.length
    ? await db
        .from("pos_products")
        .select("id, source_product_id")
        .eq("product_kind", "merchandise")
        .in("source_product_id", productIds)
    : { data: [], error: null };
  if (posProductsError) throw posProductsError;

  const typedPosProducts = (posProducts ?? []) as PosProductRow[];
  const posProductIds = typedPosProducts.map((p) => p.id);
  const { data: skuRows, error: skuRowsError } = posProductIds.length
    ? await db
        .from("pos_product_skus")
        .select("id, product_id, is_active")
        .in("product_id", posProductIds)
    : { data: [], error: null };
  if (skuRowsError) throw skuRowsError;

  const ownership = mapSkuOwnership(typedPosProducts, (skuRows ?? []) as PosSkuRow[]);
  const validation = validatePoLinesAgainstSkus(
    items.map((item) => ({ product_id: item.product_id, pos_sku_id: item.pos_sku_id ?? null })),
    ownership.rows,
    ownership.variantProductIds
  );
  if (!validation.ok) throw ApiError.badRequest(validation.error);
}

/** Baris `purchase_order_items` dari input; tepat satu diskriminan item terisi. */
export function buildPoItemRows(poId: string, items: PoCreateLine[]) {
  return items.map((item) => {
    const common = {
      purchase_order_id: poId,
      pr_item_id: item.pr_item_id || null,
      satuan_id: item.satuan_id || null,
      qty_ordered: item.qty_ordered,
      harga_satuan: item.harga_satuan,
      catatan: item.notes || null,
      is_active: true,
    };
    if ("product_id" in item) {
      return {
        ...common,
        product_id: item.product_id,
        raw_material_id: null,
        supply_item_id: null,
        pos_sku_id: item.pos_sku_id || null,
      };
    }
    if ("supply_item_id" in item) {
      return { ...common, product_id: null, raw_material_id: null, supply_item_id: item.supply_item_id };
    }
    return { ...common, raw_material_id: item.raw_material_id, product_id: null };
  });
}

/** Buat PO draft (+ item) dan tandai PR asal sebagai converted. */
export async function createPurchaseOrder(
  db: DbClient,
  moduleType: PurchasingModuleType,
  input: PoCreateInput,
  scope: UserScope | null
) {
  if (moduleType === "raw_material" && !input.pr_id) {
    throw ApiError.badRequest("Purchase order must be created from an approved purchase request");
  }

  const { companyId, branchId } = await resolvePoBusinessIds(db, input, scope);
  const { items, ...header } = input;

  if (moduleType === "product") {
    await assertProductSkuLines(db, items as Array<{ product_id: string; pos_sku_id?: string | null }>);
  }

  const totals = computePoTotals(sumPoLines(items), header);
  const nomorPo = await generateMonthlyPoNumber(db);
  const usesVendor = "vendor_id" in header;

  const { data: po, error } = await db
    .from("purchase_orders")
    .insert({
      ...header,
      nomor_po: nomorPo,
      company_id: companyId,
      branch_id: branchId,
      module_type: moduleType,
      supplier_id: usesVendor ? null : header.supplier_id,
      vendor_id: usesVendor ? header.vendor_id : null,
      status: "draft",
      ...totals,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: itemError } = await db
    .from("purchase_order_items")
    .insert(buildPoItemRows(po.id, items));
  if (itemError) throw itemError;

  if (header.pr_id) {
    const { error: prUpdateError } = await db
      .from("purchase_requests")
      .update({ status: "converted", converted_po_id: po.id, updated_at: new Date().toISOString() })
      .eq("id", header.pr_id)
      .eq("status", "approved")
      .is("converted_po_id", null);
    if (prUpdateError) throw prUpdateError;
  }

  return po;
}
