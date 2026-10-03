// ============================================
// API ROUTE: /api/purchasing/inventory/adjustment
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  effectiveBranchId,
  getApiUserScope,
  isRowInBusinessScope,
  validateWarehouseForReceivingScope,
} from "@/lib/api/scope";
import {
  ensureWarehouseInventoryId,
  listWarehouseInventoryForOpname,
} from "@/lib/inventory/stock-opname";
import { z } from "zod";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";

const adjustmentSchema = z.object({
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  qty_actual: z.number().min(0, "Stok aktual minimal 0"),
  notes: z.string().optional(),
});

const ADJUST_ROLES = ["admin", "super_admin", "warehouse_admin", "purchasing_admin"] as const;

// POST /api/purchasing/inventory/adjustment
export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const body = await request.json();

    const validated = adjustmentSchema.parse(body);
    const scope = await getApiUserScope();

    const warehouseCheck = await validateWarehouseForReceivingScope(
      validated.warehouse_id,
      scope,
      null
    );
    if ("error" in warehouseCheck) {
      return Response.json(
        { success: false, message: "Gudang tidak valid atau tidak diizinkan" },
        { status: 400 }
      );
    }

    const branchId = effectiveBranchId(scope) || warehouseCheck.branch_id;

    const { data: material } = await db
      .from("raw_materials")
      .select("company_id, branch_id, kode")
      .eq("id", validated.raw_material_id)
      .maybeSingle();

    if (
      material &&
      !isRowInBusinessScope(scope, {
        company_id: material.company_id,
        branch_id: material.branch_id,
      })
    ) {
      return Response.json(
        { success: false, message: "Bahan baku tidak tersedia untuk cabang Anda" },
        { status: 403 }
      );
    }

    const previewRows = await listWarehouseInventoryForOpname(validated.warehouse_id);
    const previewLine = previewRows.find(
      (row) => row.raw_material_id === validated.raw_material_id
    );
    if (!previewLine) {
      return Response.json(
        { success: false, message: "Bahan baku tidak ditemukan di gudang ini" },
        { status: 404 }
      );
    }

    const inventoryId =
      previewLine.inventory_id ??
      (await ensureWarehouseInventoryId(db, {
        rawMaterialId: validated.raw_material_id,
        warehouseId: validated.warehouse_id,
        branchId,
        unitCost: previewLine.unit_cost,
        userId: user.id,
      }));

    const { data: currentInv, error: invError } = await db
      .from("inventory")
      .select("*")
      .eq("id", inventoryId)
      .maybeSingle();

    if (invError || !currentInv) {
      return Response.json(
        { success: false, message: "Data inventory tidak ditemukan untuk gudang ini" },
        { status: 404 }
      );
    }

    const qtyBefore = Number(currentInv.qty_available || 0);
    const qtyDiff = validated.qty_actual - qtyBefore;

    const { data: updatedInv, error: updateError } = await db
      .from("inventory")
      .update({
        qty_available: validated.qty_actual,
        last_movement_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("id", inventoryId)
      .select()
      .single();

    if (updateError) throw updateError;

    if (qtyDiff !== 0) {
      const referenceId = crypto.randomUUID();
      const { error: movementError } = await db.from("inventory_movements").insert({
        inventory_id: inventoryId,
        raw_material_id: validated.raw_material_id,
        tipe: "adjustment",
        jumlah: Math.abs(qtyDiff),
        qty_before: qtyBefore,
        qty_after: validated.qty_actual,
        unit_cost: currentInv.unit_cost || 0,
        total_cost: Math.abs(qtyDiff) * Number(currentInv.unit_cost || 0),
        branch_id: currentInv.branch_id ?? null,
        warehouse_id: currentInv.warehouse_id ?? validated.warehouse_id,
        reference_type: "adjustment",
        reference_id: referenceId,
        alasan:
          validated.notes ||
          `Penyesuaian stok: ${qtyDiff > 0 ? "+" : ""}${qtyDiff}`,
        created_by: user.id,
        updated_by: user.id,
      });

      if (movementError) throw movementError;

      await recordAuditAfterCommit({
        actor: { id: user.id, name: user.full_name },
        action: "stock.adjust",
        entity: "inventory",
        entityId: inventoryId,
        entityLabel: material?.kode ?? null,
        before: { qty_available: qtyBefore },
        after: {
          qty_available: validated.qty_actual,
          qty_diff: qtyDiff,
          raw_material_id: validated.raw_material_id,
          warehouse_id: validated.warehouse_id,
        },
        reason: validated.notes ?? null,
        ...requestMeta(request),
      });

      let accountingNote: string | null = null;
      try {
        const {
          AccountingPostError,
          postStockAdjustmentAccounting,
        } = await import("@/lib/inventory/accounting-posting");

        const companyRow = currentInv.branch_id
          ? await (
              await import("@/lib/db")
            ).queryOne<{ company_id: string }>(
              `SELECT company_id FROM configuration.branches WHERE id = $1`,
              [currentInv.branch_id]
            )
          : null;

        const accounting = await postStockAdjustmentAccounting({
          companyId: companyRow?.company_id ?? material?.company_id ?? null,
          userId: user.id,
          documentId: referenceId,
          entryDate: new Date().toISOString().slice(0, 10),
          rawMaterialId: validated.raw_material_id,
          qtyDiff,
          unitCost: Number(currentInv.unit_cost || 0),
          notes: validated.notes,
        });
        accountingNote = accounting.note;
      } catch (err) {
        const { AccountingPostError } = await import(
          "@/lib/inventory/accounting-posting"
        );
        if (err instanceof AccountingPostError) {
          console.error("[adjustment] accounting post failed:", err.message);
          accountingNote = err.message;
        } else {
          throw err;
        }
      }

      return Response.json({
        success: true,
        data: updatedInv,
        message: accountingNote
          ? `Stok berhasil disesuaikan (${accountingNote})`
          : "Stok berhasil disesuaikan",
        accounting_note: accountingNote,
        adjustment: {
          qty_before: qtyBefore,
          qty_after: validated.qty_actual,
          qty_diff: qtyDiff,
        },
      });
    }

    return Response.json({
      success: true,
      data: updatedInv,
      message: "Stok berhasil disesuaikan",
      adjustment: {
        qty_before: qtyBefore,
        qty_after: validated.qty_actual,
        qty_diff: qtyDiff,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error adjusting inventory:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          message: "Validasi gagal",
          errors: error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { success: false, message: "Gagal menyesuaikan stok" },
      { status: 500 }
    );
  }
}
