import { queryOne, withTransaction } from "@/lib/db";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { roundQty } from "@/lib/inventory/batches";
import { SCRAP_REASONS, type ScrapReason } from "@/lib/inventory/scrap-reasons";
import {
  AccountingPostError,
  postStockAdjustmentAccounting,
} from "@/lib/inventory/accounting-posting";

/**
 * Scrap / write-off bahan baku: mengurangi stok satu gudang lewat mutasi
 * `out` ber-reference_type 'scrap'. Bila batch dipilih, trigger batch
 * mengonsumsi batch itu lebih dulu (kolom inventory_movements.batch_id).
 */


export class ScrapError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export interface ScrapInput {
  rawMaterialId: string;
  warehouseId: string;
  qty: number;
  reason: ScrapReason;
  notes?: string | null;
  batchId?: string | null;
  actor: AuditActor & { id: string };
  ip?: string | null;
  userAgent?: string | null;
}

/** Validasi qty scrap terhadap stok gudang dan sisa batch (bila dipilih). */
export function evaluateScrap(input: {
  qty: number;
  qtyAvailable: number;
  batchRemaining?: number | null;
}): string | null {
  const qty = roundQty(input.qty);
  if (!(qty > 0)) return "Qty scrap harus lebih dari 0";
  if (qty > roundQty(input.qtyAvailable)) {
    return `Stok gudang tidak cukup (tersedia ${roundQty(input.qtyAvailable)})`;
  }
  if (input.batchRemaining !== undefined && input.batchRemaining !== null && qty > roundQty(input.batchRemaining)) {
    return `Qty melebihi sisa batch (${roundQty(input.batchRemaining)})`;
  }
  return null;
}

function scrapNumber(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `SCR-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export interface ScrapResult {
  reference_id: string;
  reference_number: string;
  qty: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number;
  value: number;
  accounting_note: string | null;
}

export async function scrapStock(input: ScrapInput): Promise<ScrapResult> {
  const referenceId = crypto.randomUUID();
  const referenceNumber = scrapNumber();
  const qty = roundQty(input.qty);

  const posted = await withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      qty_available: string;
      unit_cost: string | null;
      branch_id: string | null;
    }>(
      `SELECT id, qty_available::text, unit_cost::text, branch_id
         FROM inventory.inventory
        WHERE raw_material_id = $1 AND warehouse_id = $2 AND is_active = true
        FOR UPDATE`,
      [input.rawMaterialId, input.warehouseId]
    );
    const inventory = rows[0];
    if (!inventory) throw new ScrapError(404, "Bahan baku tidak punya stok di gudang ini");

    let batchRemaining: number | null = null;
    let batchLabel: { batch_number: string | null; expiry_date: string | null } | null = null;
    if (input.batchId) {
      const batch = await client.query<{ qty_remaining: string; batch_number: string | null; expiry_date: string | null }>(
        `SELECT qty_remaining::text, batch_number, expiry_date::text
           FROM inventory.stock_batches WHERE id = $1 AND inventory_id = $2`,
        [input.batchId, inventory.id]
      );
      if (!batch.rows[0]) throw new ScrapError(404, "Batch tidak ditemukan di gudang ini");
      batchRemaining = Number(batch.rows[0].qty_remaining);
      batchLabel = { batch_number: batch.rows[0].batch_number, expiry_date: batch.rows[0].expiry_date };
    }

    const qtyBefore = Number(inventory.qty_available);
    const rejection = evaluateScrap({ qty, qtyAvailable: qtyBefore, batchRemaining });
    if (rejection) throw new ScrapError(409, rejection);

    const qtyAfter = roundQty(qtyBefore - qty);
    const unitCost = Number(inventory.unit_cost || 0);
    const reasonLabel = SCRAP_REASONS[input.reason];
    const notes = input.notes?.trim() || null;

    await client.query(
      `UPDATE inventory.inventory
          SET qty_available = $1, last_movement_at = now(), updated_at = now(), updated_by = $2
        WHERE id = $3`,
      [qtyAfter, input.actor.id, inventory.id]
    );
    await client.query(
      `INSERT INTO inventory.inventory_movements (
         inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after,
         unit_cost, total_cost, branch_id, warehouse_id,
         reference_type, reference_id, reference_number, alasan, catatan,
         batch_id, created_by, updated_by
       ) VALUES ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, 'scrap', $10, $11, $12, $13, $14, $15, $15)`,
      [
        inventory.id,
        input.rawMaterialId,
        qty,
        qtyBefore,
        qtyAfter,
        unitCost,
        qty * unitCost,
        inventory.branch_id,
        input.warehouseId,
        referenceId,
        referenceNumber,
        `Scrap: ${reasonLabel}`,
        notes,
        input.batchId || null,
        input.actor.id,
      ]
    );

    await recordAudit(client, {
      actor: input.actor,
      action: "stock.scrap",
      entity: "inventory",
      entityId: inventory.id,
      entityLabel: referenceNumber,
      before: { qty_available: qtyBefore, batch: batchLabel ? { ...batchLabel, qty_remaining: batchRemaining } : null },
      after: { qty_available: qtyAfter, qty_scrapped: qty, value: qty * unitCost, reason: input.reason },
      reason: notes ? `${reasonLabel}: ${notes}` : reasonLabel,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { qtyBefore, qtyAfter, unitCost, branchId: inventory.branch_id, notes, reasonLabel };
  });

  let accountingNote: string | null = null;
  try {
    const company = posted.branchId
      ? await queryOne<{ company_id: string }>(`SELECT company_id FROM configuration.branches WHERE id = $1`, [
          posted.branchId,
        ])
      : null;
    const accounting = await postStockAdjustmentAccounting({
      companyId: company?.company_id ?? null,
      userId: input.actor.id,
      documentId: referenceId,
      entryDate: new Date().toISOString().slice(0, 10),
      rawMaterialId: input.rawMaterialId,
      qtyDiff: -qty,
      unitCost: posted.unitCost,
      notes: `Scrap ${referenceNumber} (${posted.reasonLabel})${posted.notes ? `: ${posted.notes}` : ""}`,
    });
    accountingNote = accounting.note;
  } catch (error) {
    if (!(error instanceof AccountingPostError)) throw error;
    console.error("[scrap] accounting post failed:", error.message);
    accountingNote = error.message;
  }

  return {
    reference_id: referenceId,
    reference_number: referenceNumber,
    qty,
    qty_before: posted.qtyBefore,
    qty_after: posted.qtyAfter,
    unit_cost: posted.unitCost,
    value: Math.round(qty * posted.unitCost * 100) / 100,
    accounting_note: accountingNote,
  };
}
