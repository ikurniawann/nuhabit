import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { coverageModeForStatus, nextProductionStep } from "@/lib/purchasing/production-calc";
import { checkMaterialStock } from "@/lib/purchasing/production-orders";

export interface ProductionOrderRow {
  id: string;
  nomor_produksi: string;
  status: string;
  production_context?: string | null;
  output_type?: string | null;
  product_id: string;
  output_raw_material_id?: string | null;
  planned_qty?: number | string | null;
  overhead_cost?: number | string | null;
  labor_cost?: number | string | null;
  packaging_cost?: number | string | null;
  waste_cost?: number | string | null;
  product?: { id: string; kode?: string | null; nama?: string | null; satuan_id?: string | null } | null;
}

export async function loadProductionOrderForUpdate(db: DbClient, id: string) {
  const { data: order, error } = await db
    .from("production_orders")
    .select("*, product:products!product_id(id,kode,nama,satuan_id)")
    .eq("id", id)
    .single();
  if (error || !order) throw ApiError.notFound("Production order not found");
  return order as ProductionOrderRow;
}

export async function recheckProductionStock(db: DbClient, order: ProductionOrderRow, userId: string) {
  const stockCheck = await checkMaterialStock(db, order.id, coverageModeForStatus(order.status));
  const shortageCount = stockCheck.shortages.length;

  const { error } = await db
    .from("production_orders")
    .update({ updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", order.id);
  if (error) throw error;

  return {
    data: {
      can_release: shortageCount === 0,
      total_materials: stockCheck.coverage.length,
      insufficient_materials: shortageCount,
      shortages: stockCheck.shortages,
      coverage: stockCheck.coverage,
    },
    message:
      shortageCount === 0
        ? `Stok bahan sudah cukup. ${nextProductionStep(order.status)}`
        : `Masih ada ${shortageCount} bahan yang kurang. Buat PO atau terima barang masuk terlebih dahulu.`,
  };
}

async function setOrderStatus(
  db: DbClient,
  orderId: string,
  userId: string,
  fields: Record<string, unknown>
) {
  const { data, error } = await db
    .from("production_orders")
    .update({ ...fields, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function releaseProductionOrder(db: DbClient, order: ProductionOrderRow, userId: string) {
  if (order.status !== "DRAFT") throw ApiError.badRequest("Hanya produksi DRAFT yang bisa direlease");

  const stockCheck = await checkMaterialStock(db, order.id, "planned");
  if (stockCheck.shortages.length > 0) {
    throw ApiError.badRequest("Stok bahan belum cukup untuk release produksi", {
      shortages: stockCheck.shortages,
    });
  }
  return setOrderStatus(db, order.id, userId, { status: "RELEASED" });
}

export async function startProductionOrder(db: DbClient, order: ProductionOrderRow, userId: string) {
  if (order.status !== "RELEASED") throw ApiError.badRequest("Hanya produksi RELEASED yang bisa dimulai");
  return setOrderStatus(db, order.id, userId, {
    status: "IN_PROGRESS",
    started_at: new Date().toISOString(),
  });
}

export async function cancelProductionOrder(db: DbClient, order: ProductionOrderRow, userId: string) {
  if (order.status === "COMPLETED") throw ApiError.badRequest("Produksi completed tidak bisa dibatalkan");
  return setOrderStatus(db, order.id, userId, {
    status: "CANCELLED",
    cancelled_at: new Date().toISOString(),
  });
}
