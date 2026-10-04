import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { adjustInventoryOnOrder } from "@/lib/inventory";
import type { DbClient } from "@/lib/pg/types";
import { recalculatePurchaseOrderTotals } from "@/lib/purchasing/po-totals";
import type {
  poItemCreateSchema,
  poItemUpdateSchema,
  poUpdateSchema,
} from "@/lib/purchasing/po-schemas";
import { createBaseUnitResolver } from "@/lib/purchasing/raw-material-units";

/** Baris `purchase_orders` yang dibaca lifecycle; kolom lain ikut di-spread ke respons. */
export type PurchaseOrderRow = {
  id: string;
  nomor_po: string | null;
  status: string | null;
  grand_total?: number | string | null;
  [column: string]: unknown;
};

type OpenQtyLine = {
  raw_material_id: string | null;
  satuan_id: string | null;
  qty_ordered: number | string | null;
  qty_received: number | string | null;
};

/** Sisa qty (ordered − received, minimal 0) per baris bahan baku. */
export function openQty(line: Pick<OpenQtyLine, "qty_ordered" | "qty_received">): number {
  return Math.max(0, Number(line.qty_ordered || 0) - Number(line.qty_received || 0));
}

/** Status PO yang sudah menambah qty_on_order (dikirim, belum diterima penuh). */
export function holdsOnOrderQty(status: string): boolean {
  return status === "sent" || status === "partial" || status === "partially_received";
}

const nowIso = () => new Date().toISOString();

async function findPurchaseOrderOr404(db: DbClient, id: string): Promise<PurchaseOrderRow> {
  const { data, error } = await db.from("purchase_orders").select("*").eq("id", id).single();
  if (error || !data) throw ApiError.notFound("PO tidak ditemukan");
  return data as PurchaseOrderRow;
}

async function loadOpenQtyLines(db: DbClient, poId: string): Promise<OpenQtyLine[]> {
  const { data, error } = await db
    .from("purchase_order_items")
    .select("raw_material_id, satuan_id, qty_ordered, qty_received")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as OpenQtyLine[];
}

/**
 * Tambah (+1, saat PO dikirim) atau lepas (−1, saat PO dibatalkan) qty_on_order
 * bahan baku sebesar sisa qty, dikonversi ke satuan dasar.
 */
async function adjustOnOrderForOpenQty(db: DbClient, lines: OpenQtyLine[], direction: 1 | -1) {
  const resolveBaseUnit = await createBaseUnitResolver(
    db,
    lines.map((line) => line.raw_material_id)
  );
  for (const line of lines) {
    const remaining = openQty(line);
    if (line.raw_material_id && remaining > 0) {
      await adjustInventoryOnOrder(
        db,
        line.raw_material_id,
        direction * remaining * resolveBaseUnit(line.raw_material_id, line.satuan_id)
      );
    }
  }
}

export async function updateDraftPurchaseOrder(
  db: DbClient,
  id: string,
  input: z.infer<typeof poUpdateSchema>
) {
  const po = await findPurchaseOrderOr404(db, id);
  if (po.status !== "draft") throw ApiError.badRequest("PO hanya bisa diedit saat status draft");

  const totals = await recalculatePurchaseOrderTotals(db, id, {
    diskon_persen: input.diskon_persen,
    diskon_nominal: input.diskon_nominal,
    ppn_persen: input.ppn_persen,
  });

  const { data, error } = await db
    .from("purchase_orders")
    .update({ ...input, ...totals, updated_at: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** DELETE /po/:id — batal tanpa alasan; PO terkirim melepas qty_on_order. */
export async function voidPurchaseOrder(db: DbClient, id: string): Promise<void> {
  const po = await findPurchaseOrderOr404(db, id);
  const status = String(po.status || "").toLowerCase();
  if (status === "received") {
    throw ApiError.badRequest("PO yang sudah diterima tidak bisa dibatalkan");
  }

  const releaseOnOrder = holdsOnOrderQty(status);
  const lines = releaseOnOrder ? await loadOpenQtyLines(db, id) : [];

  const { error } = await db
    .from("purchase_orders")
    .update({ status: "cancelled", is_active: false, cancelled_at: nowIso() })
    .eq("id", id);
  if (error) throw error;

  if (releaseOnOrder) await adjustOnOrderForOpenQty(db, lines, -1);
}

/** POST /po/:id/cancel — batal dengan alasan. Mengembalikan baris sebelum & sesudah untuk audit. */
export async function cancelPurchaseOrder(db: DbClient, id: string, reason: string) {
  const before = await findPurchaseOrderOr404(db, id);
  if (before.status === "received") {
    throw ApiError.badRequest("PO yang sudah diterima sepenuhnya tidak bisa dibatalkan");
  }
  if (before.status === "cancelled") {
    throw ApiError.badRequest("PO sudah dibatalkan sebelumnya");
  }

  const { data, error } = await db
    .from("purchase_orders")
    .update({
      status: "cancelled",
      is_active: false,
      cancelled_at: nowIso(),
      cancellation_reason: reason,
      updated_at: nowIso(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return { before, data };
}

export async function approvePurchaseOrder(db: DbClient, id: string) {
  const before = await findPurchaseOrderOr404(db, id);
  if (before.status !== "draft") {
    throw ApiError.badRequest("PO hanya bisa diapprove saat status draft");
  }

  const { data: items } = await db
    .from("purchase_order_items")
    .select("id")
    .eq("purchase_order_id", id)
    .eq("is_active", true);
  if (!items || items.length === 0) {
    throw ApiError.badRequest("PO tidak memiliki item. Tambahkan item terlebih dahulu.");
  }

  const { data, error } = await db
    .from("purchase_orders")
    .update({ status: "approved", approved_at: nowIso(), updated_at: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return { before, data };
}

/** Kirim PO approved ke pemasok; sisa qty bahan baku masuk qty_on_order. */
export async function sendPurchaseOrder(db: DbClient, id: string, sentVia: string) {
  const po = await findPurchaseOrderOr404(db, id);
  if (po.status !== "approved") {
    throw ApiError.badRequest("PO harus diapprove terlebih dahulu sebelum dikirim");
  }

  const lines = await loadOpenQtyLines(db, id);
  if (lines.length === 0) throw ApiError.badRequest("PO tidak memiliki item untuk dikirim");

  const { data, error } = await db
    .from("purchase_orders")
    .update({ status: "sent", sent_via: sentVia, sent_at: nowIso(), updated_at: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  await adjustOnOrderForOpenQty(db, lines, 1);
  return data;
}

// ---- Item PO (hanya saat draft) ------------------------------------------

const PO_ITEM_RELATIONS = `
  *,
  raw_material:raw_materials!raw_material_id(id, nama, kode),
  product:products!product_id(id, nama, kode),
  satuan:units!satuan_id(id, nama, kode)`;

/** Item aktif PO beserta relasi; `withSku` ikut menyertakan SKU varian (EPIC-047). */
export async function listPurchaseOrderItems(db: DbClient, poId: string, { withSku = false } = {}) {
  const select = withSku
    ? `${PO_ITEM_RELATIONS},\n  pos_sku:pos_product_skus!pos_sku_id(id, sku, name)`
    : PO_ITEM_RELATIONS;
  const { data, error } = await db
    .from("purchase_order_items")
    .select(select)
    .eq("purchase_order_id", poId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addPurchaseOrderItem(
  db: DbClient,
  poId: string,
  input: z.infer<typeof poItemCreateSchema>
) {
  const po = await findPurchaseOrderOr404(db, poId);
  if (po.status !== "draft") {
    throw ApiError.badRequest("Item hanya bisa ditambahkan saat PO status draft");
  }

  const { data: existingItem } = await db
    .from("purchase_order_items")
    .select("id")
    .eq("purchase_order_id", poId)
    .eq("raw_material_id", input.raw_material_id)
    .eq("is_active", true)
    .single();
  if (existingItem) {
    throw ApiError.badRequest("Bahan ini sudah ada di PO. Silakan update item yang ada.");
  }

  const { data, error } = await db
    .from("purchase_order_items")
    .insert({ ...input, purchase_order_id: poId, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findDraftPoItem(db: DbClient, itemId: string, verb: "diedit" | "dihapus") {
  const { data: item, error } = await db
    .from("purchase_order_items")
    .select(`
      *,
      purchase_order:purchase_order_id (*)
    `)
    .eq("id", itemId)
    .single();
  if (error || !item) throw ApiError.notFound("Item tidak ditemukan");

  const parent = item.purchase_order as { status?: string | null } | null;
  if (parent?.status !== "draft") {
    throw ApiError.badRequest(`Item hanya bisa ${verb} saat PO status draft`);
  }
}

export async function updatePurchaseOrderItem(
  db: DbClient,
  itemId: string,
  input: z.infer<typeof poItemUpdateSchema>
) {
  await findDraftPoItem(db, itemId, "diedit");
  const { data, error } = await db
    .from("purchase_order_items")
    .update({ ...input, updated_at: nowIso() })
    .eq("id", itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removePurchaseOrderItem(db: DbClient, itemId: string): Promise<void> {
  await findDraftPoItem(db, itemId, "dihapus");
  const { error } = await db
    .from("purchase_order_items")
    .update({ is_active: false })
    .eq("id", itemId);
  if (error) throw error;
}
