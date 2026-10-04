import { ApiError } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { recordAudit, type AuditActor } from "@/lib/audit";

/**
 * Revisi retur pembelian yang ditolak (port ReviseReturn, NüHabit).
 *
 * Penolakan bukan jalan buntu: dokumen yang ditolak tetap utuh sebagai
 * riwayat, dan revisinya adalah dokumen draft baru (nomor `<asal>-R<n>`)
 * yang menyalin baris retur supaya bisa diperbaiki lalu diajukan ulang.
 */

export interface ReturnForRevision {
  status: string | null;
  superseded_by: string | null;
}

export function evaluateReturnRevision(ret: ReturnForRevision | null): { status: 404 | 409; message: string } | null {
  if (!ret) return { status: 404, message: "Retur tidak ditemukan" };
  if (ret.superseded_by) return { status: 409, message: "Retur ini sudah pernah direvisi" };
  if (ret.status !== "rejected") return { status: 409, message: "Hanya retur yang ditolak yang bisa direvisi" };
  return null;
}

/** RET-2026-004 → RET-2026-004-R1; RET-2026-004-R1 → RET-2026-004-R2. */
export function revisionNumber(returnNumber: string, revisionNo: number): string {
  return `${returnNumber.replace(/-R\d+$/, "")}-R${revisionNo}`;
}

type ReturnRow = ReturnForRevision & {
  id: string;
  return_number: string;
  revision_no: number;
  rejection_reason: string | null;
};

export async function revisePurchaseReturn(opts: {
  returnId: string;
  actor: AuditActor & { id: string };
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string; return_number: string; revision_no: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<ReturnRow>(
      `SELECT id, return_number, status, superseded_by, revision_no, rejection_reason
         FROM purchasing.purchase_returns WHERE id = $1 FOR UPDATE`,
      [opts.returnId]
    );
    const current = rows[0] ?? null;
    const rejection = evaluateReturnRevision(current);
    if (rejection) throw new ApiError(rejection.status, rejection.message);

    const revisionNo = current!.revision_no + 1;
    const number = revisionNumber(current!.return_number, revisionNo);
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO purchasing.purchase_returns (
         return_number, grn_id, supplier_id, vendor_id, return_date, reason_type, reason_notes,
         status, total_amount, notes, company_id, branch_id, created_by, revision_no, revision_of
       )
       SELECT $2, grn_id, supplier_id, vendor_id, CURRENT_DATE, reason_type, reason_notes,
              'draft', total_amount, notes, company_id, branch_id, created_by, $3, id
         FROM purchasing.purchase_returns WHERE id = $1
       RETURNING id`,
      // created_by mengacu hris.staff, bukan users: salin dari dokumen asal.
      [current!.id, number, revisionNo]
    );
    const newId = inserted[0].id;

    await client.query(
      `INSERT INTO purchasing.purchase_return_items (
         return_id, grn_item_id, raw_material_id, product_id, qty_returned, unit_cost, subtotal,
         batch_number, expiry_date, condition_notes, qc_status
       )
       SELECT $2, grn_item_id, raw_material_id, product_id, qty_returned, unit_cost, subtotal,
              batch_number, expiry_date, condition_notes, qc_status
         FROM purchasing.purchase_return_items WHERE return_id = $1`,
      [current!.id, newId]
    );
    await client.query(
      `UPDATE purchasing.purchase_returns SET superseded_by = $2, updated_at = now() WHERE id = $1`,
      [current!.id, newId]
    );

    await recordAudit(client, {
      actor: opts.actor,
      action: "purchase_return.revise",
      entity: "purchase_return",
      entityId: current!.id,
      entityLabel: current!.return_number,
      before: { status: current!.status, rejection_reason: current!.rejection_reason },
      after: { revision_id: newId, revision_number: number, status: "draft" },
      reason: current!.rejection_reason,
      ip: opts.ip,
      userAgent: opts.userAgent,
    });

    return { id: newId, return_number: number, revision_no: revisionNo };
  });
}
