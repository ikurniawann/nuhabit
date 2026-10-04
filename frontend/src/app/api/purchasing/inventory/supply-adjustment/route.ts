// EPIC-026 C2 — POST /api/purchasing/inventory/supply-adjustment — set stok barang
// operasional ke nilai aktual (guard IAM items).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { effectiveBranchId, effectiveCompanyId, getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { adjustSupplyStock } from "@/lib/purchasing/supply-inventory";

const adjustmentSchema = z.object({
  supply_item_id: z.string().uuid("Barang wajib dipilih"),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  qty_actual: z.number().min(0, "Stok aktual minimal 0"),
  notes: z.string().optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(adjustmentSchema, await request.json());
  const data = await adjustSupplyStock(db, {
    supplyItemId: input.supply_item_id,
    warehouseId: input.warehouse_id,
    qtyActual: input.qty_actual,
    alasan: input.notes || null,
    companyId: effectiveCompanyId(scope),
    branchId: effectiveBranchId(scope),
    userId: user.id,
  });
  return NextResponse.json({ success: true, data, message: "Stok berhasil disesuaikan" });
}, "purchasing.inventory.supply-adjustment");
