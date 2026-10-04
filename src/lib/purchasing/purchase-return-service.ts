import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import { reduceInventoryFromPurchaseReturn } from "@/lib/inventory";
import { reduceProductInventoryFromPurchaseReturn } from "@/lib/inventory/product-purchase-return";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  enrichPurchaseReturnsWithGrn,
  listScopedQcCompletedGrnIds,
} from "@/lib/purchasing/purchase-returns";
import {
  buildReturnItemRows,
  sumReturnLines,
  type ReturnLineInput,
  type returnCreateSchema,
  type returnUpdateSchema,
} from "@/lib/purchasing/return-schemas";

const QTY_EPSILON = 0.000001;

const EDITABLE_RETURN_STATUSES = ["draft", "pending_approval"] as const;

function toQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertReturnEditable(status: string) {
  if (!EDITABLE_RETURN_STATUSES.includes(status as (typeof EDITABLE_RETURN_STATUSES)[number])) {
    throw ApiError.badRequest("Purchase return can only be edited before approval");
  }
}

async function validateReturnLineItems(
  db: DbClient,
  grnId: string,
  items: ReturnLineInput[],
  excludeReturnId?: string
) {
  if (!items.length) {
    throw ApiError.badRequest("At least one return item is required");
  }

  const excludeQtyByGrnItem = new Map<string, number>();
  if (excludeReturnId) {
    const { data: existingLines, error } = await db
      .from("purchase_return_items")
      .select("grn_item_id, qty_returned")
      .eq("return_id", excludeReturnId);

    if (error) throw error;

    const lines = (existingLines ?? []) as Array<{ grn_item_id: string | null; qty_returned: unknown }>;
    for (const line of lines) {
      if (!line.grn_item_id) continue;
      excludeQtyByGrnItem.set(
        line.grn_item_id,
        (excludeQtyByGrnItem.get(line.grn_item_id) || 0) + toQty(line.qty_returned)
      );
    }
  }

  for (const item of items) {
    if (toQty(item.qty_returned) <= 0) {
      throw ApiError.badRequest("Return quantity must be greater than zero");
    }

    const { data: grnItem, error } = await db
      .from("grn_items")
      .select(
        `
        id,
        grn_id,
        raw_material_id,
        product_id,
        qty_qc_posted,
        qty_returned,
        raw_material:raw_materials (nama),
        product:products (nama)
      `
      )
      .eq("id", item.grn_item_id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!grnItem || grnItem.grn_id !== grnId) {
      throw ApiError.badRequest("Return item does not belong to the selected goods receipt");
    }

    const posted = toQty(grnItem.qty_qc_posted);
    const alreadyReturned = toQty(grnItem.qty_returned);
    const giveBack = excludeQtyByGrnItem.get(item.grn_item_id) || 0;
    const available = Math.max(0, posted - alreadyReturned + giveBack);

    if (toQty(item.qty_returned) > available + QTY_EPSILON) {
      const materialName =
        (grnItem.raw_material as { nama?: string } | null)?.nama ||
        (grnItem.product as { nama?: string } | null)?.nama ||
        "item";
      throw ApiError.badRequest(
        `Return quantity for ${materialName} exceeds available stock (${available})`
      );
    }
  }
}

async function replacePurchaseReturnItems(
  db: DbClient,
  returnId: string,
  items: ReturnLineInput[]
) {
  const { error: deleteError } = await db
    .from("purchase_return_items")
    .delete()
    .eq("return_id", returnId);

  if (deleteError) throw deleteError;

  const { error: insertError } = await db.from("purchase_return_items").insert(buildReturnItemRows(returnId, items));
  if (insertError) throw insertError;
}

export async function approvePurchaseReturn(
  db: DbClient,
  returnId: string,
  userId: string
) {
  const { data: currentReturn, error: fetchError } = await db
    .from("purchase_returns")
    .select(
      `
      *,
      grn:grn (nomor_grn),
      items:purchase_return_items (
        id,
        grn_item_id,
        raw_material_id,
        product_id,
        qty_returned,
        unit_cost,
        condition_notes,
        grn_item:grn_items (
          warehouse_id
        )
      )
    `
    )
    .eq("id", returnId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!currentReturn) {
    throw ApiError.notFound("Purchase return not found");
  }

  if (currentReturn.status !== "pending_approval") {
    throw ApiError.badRequest("Only pending returns can be approved");
  }

  const returnNumber = currentReturn.return_number as string;
  const items = (currentReturn.items || []) as Array<{
    grn_item_id: string;
    raw_material_id: string | null;
    product_id: string | null;
    qty_returned: number;
    unit_cost: number;
    condition_notes?: string | null;
    grn_item?: { warehouse_id?: string | null } | null;
  }>;

  if (!items.length) {
    throw ApiError.badRequest("Purchase return has no items");
  }

  for (const item of items) {
    if (item.product_id) {
      await reduceProductInventoryFromPurchaseReturn(db, {
        productId: item.product_id,
        qtyReturned: toQty(item.qty_returned),
        unitCost: toQty(item.unit_cost),
        returnId,
        returnNumber,
        userId,
        conditionNotes: item.condition_notes,
      });
      continue;
    }

    if (!item.raw_material_id) {
      throw ApiError.badRequest("Return item is missing material reference");
    }

    await reduceInventoryFromPurchaseReturn(db, {
      rawMaterialId: item.raw_material_id,
      qtyReturned: toQty(item.qty_returned),
      unitCost: toQty(item.unit_cost),
      returnId,
      returnNumber,
      warehouseId: item.grn_item?.warehouse_id ?? null,
      userId,
      conditionNotes: item.condition_notes,
    });
  }

  for (const item of items) {
    const { data: grnItem, error: grnItemError } = await db
      .from("grn_items")
      .select("qty_returned")
      .eq("id", item.grn_item_id)
      .maybeSingle();

    if (grnItemError) throw grnItemError;
    if (!grnItem) continue;

    const { error: grnUpdateError } = await db
      .from("grn_items")
      .update({
        qty_returned: toQty(grnItem.qty_returned) + toQty(item.qty_returned),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.grn_item_id);

    if (grnUpdateError) throw grnUpdateError;
  }

  const { data: updatedReturn, error: updateError } = await db
    .from("purchase_returns")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnId)
    .select()
    .single();

  if (updateError) throw updateError;

  const totalAmount = items.reduce(
    (sum, item) => sum + toQty(item.qty_returned) * toQty(item.unit_cost),
    0
  );

  const { postReturnAccountingJournal } = await import(
    "@/lib/purchasing/accounting-posting"
  );
  await postReturnAccountingJournal({
    companyId: (currentReturn.company_id as string | null) ?? null,
    userId,
    returnId,
    returnNumber,
    returnDate: String(
      currentReturn.return_date || new Date().toISOString().slice(0, 10)
    ),
    totalAmount,
  });

  return updatedReturn;
}

const RETURN_DETAIL_SELECT = `
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
  ),
  items:purchase_return_items (
    id,
    return_id,
    grn_item_id,
    raw_material_id,
    product_id,
    qty_returned,
    unit_cost,
    subtotal,
    batch_number,
    expiry_date,
    condition_notes,
    qc_status,
    created_at,
    grn_item:grn_items (
      warehouse_id,
      warehouse:warehouses (
        name
      )
    ),
    raw_material:raw_materials (
      kode,
      nama
    ),
    product:products (
      kode,
      nama
    )
  )
`;

/** Retur dengan GRN di luar scope bisnis (atau belum QC) diperlakukan sebagai tidak ada. */
async function assertReturnGrnInScope(db: DbClient, scope: UserScope | null, grnId: string | null) {
  if (!grnId) return;
  const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope);
  if (!scopedGrnIds.includes(grnId)) throw ApiError.notFound("Purchase return not found");
}

export async function getPurchaseReturn(db: DbClient, id: string, scope: UserScope | null) {
  const { data, error } = await db
    .from("purchase_returns")
    .select(RETURN_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound("Purchase return not found");
  await assertReturnGrnInScope(db, scope, data.grn_id);

  const [enriched] = await enrichPurchaseReturnsWithGrn(db, [data]);
  return enriched;
}

/** Retur baru (status pending_approval) dari GRN yang sudah selesai QC dan dalam scope. */
export async function createPurchaseReturn(
  db: DbClient,
  input: z.infer<typeof returnCreateSchema>,
  scope: UserScope | null
) {
  const moduleType = parsePurchasingModuleType(input.module_type);
  const items = input.items ?? [];
  if (!input.return_date || !input.reason_type || items.length === 0) {
    throw ApiError.badRequest("Required fields are incomplete");
  }
  if (moduleType === "product" && !input.vendor_id) {
    throw ApiError.badRequest("Vendor is required for product returns");
  }
  if (moduleType === "raw_material" && !input.supplier_id) {
    throw ApiError.badRequest("Supplier is required for purchase returns");
  }
  if (!input.grn_id) throw ApiError.badRequest("Goods receipt is required for purchase returns");

  const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope, moduleType);
  if (!scopedGrnIds.includes(input.grn_id)) {
    throw ApiError.badRequest("Goods receipt is not eligible for return (QC incomplete or out of scope)");
  }

  const { data: grn, error: grnError } = await db
    .from("grn")
    .select("id, company_id, branch_id, supplier_id, vendor_id, purchase_order_id")
    .eq("id", input.grn_id)
    .eq("is_active", true)
    .maybeSingle();
  if (grnError) throw grnError;
  if (!grn) throw ApiError.notFound("Goods receipt not found");

  await validateReturnLineItems(db, input.grn_id, items);

  const isProduct = moduleType === "product";
  const { data: created, error: returnError } = await db
    .from("purchase_returns")
    .insert({
      grn_id: input.grn_id,
      supplier_id: isProduct ? null : input.supplier_id || grn.supplier_id,
      vendor_id: isProduct ? input.vendor_id || grn.vendor_id : null,
      return_date: input.return_date,
      reason_type: input.reason_type,
      reason_notes: input.reason_notes,
      status: "pending_approval",
      total_amount: sumReturnLines(items),
      notes: input.notes,
      company_id: grn.company_id ?? null,
      branch_id: grn.branch_id ?? null,
    })
    .select()
    .single();
  if (returnError) throw returnError;

  const { error: itemsError } = await db
    .from("purchase_return_items")
    .insert(buildReturnItemRows(created.id, items));
  if (itemsError) {
    await db.from("purchase_returns").delete().eq("id", created.id);
    throw itemsError;
  }

  const { data } = await db
    .from("purchase_returns")
    .select(`
      *,
      supplier:suppliers (nama_supplier),
      vendor:vendors (name),
      items:purchase_return_items (
        *,
        raw_material:raw_materials (kode, nama, satuan),
        product:products (kode, nama)
      )
    `)
    .eq("id", created.id)
    .single();
  return data;
}

/** Ubah retur draft/pending: header + ganti seluruh item, kembali ke pending_approval. */
export async function updatePurchaseReturn(
  db: DbClient,
  id: string,
  input: z.infer<typeof returnUpdateSchema>,
  scope: UserScope | null
) {
  const { data: current, error: fetchError } = await db
    .from("purchase_returns")
    .select("id, grn_id, status, company_id, branch_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!current) throw ApiError.notFound("Purchase return not found");
  await assertReturnGrnInScope(db, scope, current.grn_id);

  assertReturnEditable(String(current.status));
  if (!current.grn_id) throw ApiError.badRequest("Goods receipt is required");

  await validateReturnLineItems(db, current.grn_id, input.items, id);

  const { error: headerError } = await db
    .from("purchase_returns")
    .update({
      return_date: input.return_date,
      reason_type: input.reason_type,
      reason_notes: input.reason_notes ?? null,
      notes: input.notes ?? null,
      total_amount: sumReturnLines(input.items),
      status: "pending_approval",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (headerError) throw headerError;

  await replacePurchaseReturnItems(db, id, input.items);

  const { data, error } = await db
    .from("purchase_returns")
    .select(`
      *,
      supplier:suppliers (id, nama_supplier),
      grn:grn (id, nomor_grn),
      items:purchase_return_items (
        *,
        raw_material:raw_materials (kode, nama),
        grn_item:grn_items (warehouse_id)
      )
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;

  const [enriched] = await enrichPurchaseReturnsWithGrn(db, data ? [data] : []);
  return enriched;
}

export async function rejectPurchaseReturn(
  db: DbClient,
  id: string,
  reason: string | null | undefined,
  userId: string
) {
  if (!reason) throw ApiError.badRequest("Alasan penolakan wajib diisi");

  const { data: current, error: fetchError } = await db
    .from("purchase_returns")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError || !current) throw ApiError.notFound("Return tidak ditemukan");
  if (current.status !== "pending_approval") {
    throw ApiError.badRequest("Return tidak dalam status pending approval");
  }

  const { data, error } = await db
    .from("purchase_returns")
    .update({
      status: "rejected",
      rejection_reason: reason,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
