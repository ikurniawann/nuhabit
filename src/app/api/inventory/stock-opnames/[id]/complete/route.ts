import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne, withTransaction } from "@/lib/db";
import { fetchStockOpnameDetail } from "@/lib/inventory/stock-opname";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  AccountingPostError,
  postStockOpnameAccounting,
} from "@/lib/inventory/accounting-posting";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.itemsInventory);
    const { id } = await context.params;
    const detail = await fetchStockOpnameDetail(id);

    if (!detail) {
      return Response.json(
        { success: false, message: "Stock opname tidak ditemukan" },
        { status: 404 }
      );
    }

    if (detail.status === "completed") {
      return Response.json(
        { success: false, message: "Stock opname sudah diselesaikan sebelumnya" },
        { status: 400 }
      );
    }

    if (detail.status === "cancelled") {
      return Response.json(
        { success: false, message: "Stock opname yang dibatalkan tidak dapat diselesaikan" },
        { status: 400 }
      );
    }

    const uncounted = detail.lines.filter(
      (line) => line.qty_counted === null || line.qty_counted === undefined
    );
    if (uncounted.length > 0) {
      return Response.json(
        {
          success: false,
          message: `Masih ada ${uncounted.length} baris yang belum dihitung`,
        },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      for (const line of detail.lines) {
        const qtyBefore = line.qty_system;
        const qtyAfter = toNumber(line.qty_counted);
        const qtyDiff = qtyAfter - qtyBefore;

        if (qtyDiff === 0) continue;

        const invRes = await client.query<{
          id: string;
          branch_id: string | null;
          warehouse_id: string | null;
          unit_cost: number | string | null;
        }>(
          `SELECT id, branch_id, warehouse_id, unit_cost
           FROM inventory.inventory
           WHERE id = $1
           FOR UPDATE`,
          [line.inventory_id]
        );

        const inv = invRes.rows[0];
        if (!inv) {
          throw new Error(`Inventory ${line.inventory_id} tidak ditemukan`);
        }

        await client.query(
          `UPDATE inventory.inventory
           SET qty_available = $1,
               last_movement_at = now(),
               updated_at = now(),
               updated_by = $2
           WHERE id = $3`,
          [qtyAfter, user.id, line.inventory_id]
        );

        const unitCost = toNumber(inv.unit_cost ?? line.unit_cost);
        await client.query(
          `INSERT INTO inventory.inventory_movements (
             inventory_id, raw_material_id, tipe, jumlah,
             qty_before, qty_after, unit_cost, total_cost,
             branch_id, warehouse_id,
             reference_type, reference_id, reference_number, alasan,
             created_by, updated_by
           ) VALUES (
             $1, $2, 'adjustment', $3,
             $4, $5, $6, $7,
             $8, $9,
             'stock_opname', $10, $11, $12,
             $13, $13
           )`,
          [
            line.inventory_id,
            line.raw_material_id,
            Math.abs(qtyDiff),
            qtyBefore,
            qtyAfter,
            unitCost,
            Math.abs(qtyDiff) * unitCost,
            inv.branch_id,
            inv.warehouse_id,
            detail.id,
            detail.opname_number,
            line.notes ||
              `Stock opname ${detail.opname_number}: ${qtyDiff > 0 ? "+" : ""}${qtyDiff}`,
            user.id,
          ]
        );
      }

      await client.query(
        `UPDATE inventory.stock_opnames
         SET status = 'completed',
             completed_at = now(),
             lines_counted = $2,
             lines_with_variance = $3,
             updated_by = $4,
             updated_at = now()
         WHERE id = $1`,
        [
          detail.id,
          detail.lines.length,
          detail.lines.filter((l) => {
            const counted = toNumber(l.qty_counted);
            return counted - l.qty_system !== 0;
          }).length,
          user.id,
        ]
      );

      const varianceLines = detail.lines
        .map((line) => ({
          raw_material_id: line.raw_material_id,
          inventory_id: line.inventory_id,
          qty_system: line.qty_system,
          qty_counted: toNumber(line.qty_counted),
        }))
        .filter((line) => line.qty_counted !== line.qty_system);
      await recordAudit(client, {
        actor: { id: user.id, name: user.full_name },
        action: "stock.opname_complete",
        entity: "stock_opname",
        entityId: detail.id,
        entityLabel: detail.opname_number,
        before: { status: detail.status },
        after: {
          status: "completed",
          lines_counted: detail.lines.length,
          variances: varianceLines,
        },
        ...requestMeta(request),
      });
    });

    let accountingNote: string | null = null;
    try {
      const companyRow = detail.branch_id
        ? await queryOne<{ company_id: string }>(
            `SELECT company_id FROM configuration.branches WHERE id = $1`,
            [detail.branch_id]
          )
        : null;

      const varianceLines = detail.lines.map((line) => {
        const qtyAfter = toNumber(line.qty_counted);
        return {
          raw_material_id: line.raw_material_id,
          qty_diff: qtyAfter - line.qty_system,
          unit_cost: toNumber(line.unit_cost),
          material_nama: line.material_nama,
        };
      });

      const accounting = await postStockOpnameAccounting({
        companyId: companyRow?.company_id ?? null,
        userId: user.id,
        opnameId: detail.id,
        opnameNumber: detail.opname_number,
        opnameDate: String(detail.opname_date).slice(0, 10),
        lines: varianceLines,
      });
      accountingNote = accounting.note;
    } catch (err) {
      if (err instanceof AccountingPostError) {
        console.error("[stock-opname] accounting post failed:", err.message);
        accountingNote = err.message;
      } else {
        throw err;
      }
    }

    const updated = await fetchStockOpnameDetail(id);
    const baseMessage = "Stock opname selesai dan stok telah disesuaikan";
    return Response.json({
      success: true,
      data: updated,
      message: accountingNote ? `${baseMessage} (${accountingNote})` : baseMessage,
      accounting_note: accountingNote,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("POST complete stock-opname:", error);
    const message =
      error instanceof Error ? error.message : "Gagal menyelesaikan stock opname";
    return Response.json({ success: false, message }, { status: 500 });
  }
}
