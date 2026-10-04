// EPIC-026 C2 — pemakaian/pengeluaran barang operasional (stok keluar) untuk
// /api/purchasing/inventory/supply-usage.
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { effectiveBranchId, effectiveCompanyId, type UserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import type { DbClient } from "@/lib/pg/types";
import { localDateStamp } from "@/lib/purchasing/item-codes";
import { reduceSupplyStock } from "@/lib/purchasing/supply-inventory";
import { supplyBranchFilter } from "@/lib/purchasing/supply-inventory-queries";

export const supplyUsageSchema = z.object({
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  tanggal: z.string().optional(),
  divisi: z.string().optional(),
  keperluan: z.string().optional(),
  catatan: z.string().optional(),
  items: z
    .array(
      z.object({
        supply_item_id: z.string().uuid(),
        qty: z.number().positive("Qty harus lebih dari 0"),
        catatan: z.string().optional(),
      })
    )
    .min(1, "Minimal satu barang"),
});

export type SupplyUsageInput = z.infer<typeof supplyUsageSchema>;

/** PMK-YYYYMMDD-NNNN; urutan = jumlah nomor hari itu + 1. */
export function supplyUsageNumber(dateStamp: string, countToday: number): string {
  return `PMK-${dateStamp}-${String(countToday + 1).padStart(4, "0")}`;
}

/** Pesan galat bila qty diminta melebihi saldo; null bila cukup. */
export function insufficientStockMessage(requested: number, available: number): string | null {
  return requested > available
    ? `Stok tidak cukup untuk salah satu barang (tersedia ${available}, diminta ${requested})`
    : null;
}

/** 100 pemakaian terbaru dalam cabang user (+ baris global). */
export async function listSupplyUsages(scope: UserScope) {
  return query(
    `SELECT su.id, su.nomor, su.tanggal, su.warehouse_id, w.name AS warehouse_nama,
            su.divisi, su.keperluan, su.total_items, su.created_at
     FROM supply_usages su
     LEFT JOIN configuration.warehouses w ON w.id = su.warehouse_id
     WHERE ($1::uuid IS NULL OR su.branch_id = $1 OR su.branch_id IS NULL)
     ORDER BY su.tanggal DESC, su.created_at DESC
     LIMIT 100`,
    [supplyBranchFilter(scope)]
  );
}

async function availableQty(supplyItemId: string, warehouseId: string): Promise<number> {
  const rows = await query<{ qty: string }>(
    `SELECT COALESCE(qty_available,0)::text AS qty
     FROM supply_inventory
     WHERE supply_item_id = $1
       AND COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND is_active = true`,
    [supplyItemId, warehouseId]
  );
  return Number(rows[0]?.qty ?? 0);
}

async function nextUsageNumber(): Promise<string> {
  const dateStamp = localDateStamp();
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM supply_usages WHERE nomor LIKE $1`,
    [`PMK-${dateStamp}-%`]
  );
  return supplyUsageNumber(dateStamp, Number(rows[0]?.n ?? 0));
}

/**
 * Catat pemakaian: semua saldo dicek dulu sebelum stok apa pun dikurangi,
 * lalu header, pengurangan stok, dan baris item ditulis berurutan.
 */
export async function createSupplyUsage(
  db: DbClient,
  scope: UserScope | null,
  userId: string,
  input: SupplyUsageInput
): Promise<{ id: string; nomor: string }> {
  for (const item of input.items) {
    const message = insufficientStockMessage(
      item.qty,
      await availableQty(item.supply_item_id, input.warehouse_id)
    );
    if (message) throw ApiError.badRequest(message);
  }

  const companyId = effectiveCompanyId(scope);
  const branchId = effectiveBranchId(scope);
  const nomor = await nextUsageNumber();

  const { data, error: headerError } = await db
    .from("supply_usages")
    .insert({
      nomor,
      tanggal: input.tanggal || new Date().toISOString().split("T")[0],
      warehouse_id: input.warehouse_id,
      divisi: input.divisi || null,
      keperluan: input.keperluan || null,
      catatan: input.catatan || null,
      total_items: input.items.length,
      company_id: companyId,
      branch_id: branchId,
      created_by: userId,
    })
    .select("id, nomor")
    .single();
  if (headerError) throw headerError;
  if (!data) throw ApiError.server("Gagal menyimpan pemakaian");
  const header = data as { id: string; nomor: string };

  for (const item of input.items) {
    const { unitCost } = await reduceSupplyStock(db, {
      supplyItemId: item.supply_item_id,
      warehouseId: input.warehouse_id,
      qty: item.qty,
      referenceType: "usage",
      referenceId: header.id,
      referenceNumber: header.nomor,
      alasan: input.keperluan || `Pemakaian ${header.nomor}`,
      catatan: item.catatan || null,
      companyId,
      branchId,
      userId,
    });

    await db.from("supply_usage_items").insert({
      usage_id: header.id,
      supply_item_id: item.supply_item_id,
      qty: item.qty,
      unit_cost: unitCost,
      catatan: item.catatan || null,
    });
  }

  return header;
}
