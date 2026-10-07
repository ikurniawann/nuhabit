import type { DbClient } from "@/lib/pg/types";
import { recordFinishedGoodsMovement } from "@/lib/inventory/finished-goods-movements";
import { ensureProductInventoryId } from "@/lib/inventory/product-stock-opname";

const QTY_EPSILON = 0.000001;

function toQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reduce finished goods stock when a product purchase return is approved. */
export async function reduceProductInventoryFromPurchaseReturn(
  db: DbClient,
  params: {
    productId: string;
    qtyReturned: number;
    unitCost: number;
    returnId: string;
    returnNumber: string;
    userId: string;
    conditionNotes?: string | null;
  }
): Promise<void> {
  const qty = toQty(params.qtyReturned);
  if (qty <= 0) return;

  const inventoryId = await ensureProductInventoryId(db, {
    productId: params.productId,
    unitCost: toQty(params.unitCost),
    userId: params.userId,
  });

  const { data: existing, error: existingError } = await db
    .from("finished_goods_inventory")
    .select("id, qty_available, unit_cost")
    .eq("id", inventoryId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existing) {
    throw new Error("Insufficient product stock for this return");
  }

  const qtyBefore = toQty(existing.qty_available);
  if (qtyBefore + QTY_EPSILON < qty) {
    throw new Error("Insufficient product stock for this return");
  }

  const qtyAfter = Math.max(0, qtyBefore - qty);

  const { error: updateError } = await db
    .from("finished_goods_inventory")
    .update({
      qty_available: qtyAfter,
      last_movement_at: new Date().toISOString(),
      updated_by: params.userId,
    })
    .eq("id", existing.id);

  if (updateError) throw updateError;

  await recordFinishedGoodsMovement(db, {
    inventoryId: existing.id,
    productId: params.productId,
    tipe: "return",
    qtyBefore,
    qtyAfter,
    unitCost: toQty(existing.unit_cost) || toQty(params.unitCost),
    referenceType: "product_purchase_return",
    referenceId: params.returnId,
    referenceNumber: params.returnNumber,
    alasan: "Purchase return approved",
    catatan: params.conditionNotes ?? null,
    userId: params.userId,
  });
}
