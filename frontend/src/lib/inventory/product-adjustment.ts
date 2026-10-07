import type { UserScope } from "@/lib/api/scope";
import { isRowInBusinessScope } from "@/lib/api/scope";
import { queryOne } from "@/lib/db";
import { recordFinishedGoodsMovement } from "@/lib/inventory/finished-goods-movements";
import { ensureProductInventoryId } from "@/lib/inventory/product-stock-opname";

type PgClient = Awaited<
  ReturnType<typeof import("@/lib/pg/create-client").createServerPgClient>
>;

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function adjustProductStock(params: {
  db: PgClient;
  scope: UserScope | null;
  userId: string;
  productId: string;
  qtyActual: number;
  notes?: string;
}) {
  const product = await queryOne<{
    id: string;
    company_id: string | null;
    branch_id: string | null;
    harga_modal: number | string | null;
    kode: string;
    nama: string;
  }>(
    `SELECT id, company_id, branch_id, harga_modal, kode, nama
     FROM products
     WHERE id = $1
       AND deleted_at IS NULL
       AND is_active = true`,
    [params.productId]
  );

  if (!product) {
    return { error: "not_found" as const };
  }

  if (
    !isRowInBusinessScope(params.scope, {
      company_id: product.company_id,
      branch_id: product.branch_id,
    })
  ) {
    return { error: "forbidden" as const };
  }

  const unitCost = toNumber(product.harga_modal);

  const inventoryId = await ensureProductInventoryId(params.db, {
    productId: params.productId,
    unitCost,
    userId: params.userId,
  });

  const current = await queryOne<{
    id: string;
    qty_available: number | string;
    unit_cost: number | string | null;
  }>(
    `SELECT id, qty_available, unit_cost
     FROM inventory.finished_goods_inventory
     WHERE id = $1
       AND is_active = true`,
    [inventoryId]
  );

  if (!current) {
    return { error: "inventory_not_found" as const };
  }

  const qtyBefore = toNumber(current.qty_available);
  const qtyDiff = params.qtyActual - qtyBefore;

  const { data: updated, error: updateError } = await params.db
    .from("finished_goods_inventory")
    .update({
      qty_available: params.qtyActual,
      last_movement_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: params.userId,
    })
    .eq("id", inventoryId)
    .select()
    .single();

  if (updateError || !updated) throw updateError ?? new Error("Gagal memperbarui stok produk");

  await recordFinishedGoodsMovement(params.db, {
    inventoryId,
    productId: params.productId,
    tipe: "adjustment",
    qtyBefore,
    qtyAfter: params.qtyActual,
    unitCost: toNumber(current.unit_cost) || unitCost,
    referenceType: "manual_adjustment",
    referenceNumber: product.kode,
    alasan: "Manual stock adjustment",
    catatan: params.notes ?? null,
    userId: params.userId,
  });

  return {
    data: updated,
    adjustment: {
      product_id: params.productId,
      product_kode: product.kode,
      product_nama: product.nama,
      qty_before: qtyBefore,
      qty_after: params.qtyActual,
      qty_diff: qtyDiff,
      notes: params.notes ?? null,
    },
  };
}
