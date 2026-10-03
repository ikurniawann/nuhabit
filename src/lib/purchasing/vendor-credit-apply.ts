import { query, withTransaction } from "@/lib/db";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { todayJakarta } from "@/lib/inventory/batches";
import {
  allocateCredits,
  creditRemaining,
  isCreditExpired,
  type CreditAllocation,
  type VendorCreditBalance,
} from "@/lib/purchasing/vendor-credit-allocation";

/**
 * Pakai kredit vendor yang sudah disetujui ke PO lain milik pemasok yang sama.
 * Kredit tertua dulu, kredit kedaluwarsa dilewati (allocateCredits).
 */

export class CreditApplyError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

type PoParty = { id: string; nomor_po: string; supplier_id: string | null; vendor_id: string | null };

const CREDITS_FOR_PARTY = `
  SELECT vc.id, vc.credit_number, vc.credit_date::text AS credit_date,
         vc.total_amount::float8 AS total_amount, vc.applied_amount::float8 AS applied_amount,
         vc.status, vc.expiry_date::text AS expiry_date,
         po.id AS origin_po_id, po.nomor_po AS origin_po_number
    FROM purchasing.vendor_credits vc
    JOIN purchasing.grn g ON g.id = vc.grn_id
    JOIN purchasing.purchase_orders po ON po.id = g.purchase_order_id
   WHERE vc.status = 'approved'
     AND (($1::uuid IS NOT NULL AND po.supplier_id = $1) OR ($2::uuid IS NOT NULL AND po.vendor_id = $2))
     AND po.id <> $3
   ORDER BY vc.credit_date, vc.created_at`;

export type PartyCredit = VendorCreditBalance & {
  origin_po_id: string;
  origin_po_number: string;
  remaining: number;
  expired: boolean;
};

async function loadPo(poId: string): Promise<PoParty> {
  const rows = await query<PoParty>(
    `SELECT id, nomor_po, supplier_id, vendor_id FROM purchasing.purchase_orders WHERE id = $1`,
    [poId]
  );
  if (!rows[0]) throw new CreditApplyError(404, "PO tidak ditemukan");
  return rows[0];
}

/** Kredit pemasok PO ini (dari PO lain) beserta sisa dan status kedaluwarsa. */
export async function listCreditsForPo(poId: string, today = todayJakarta()): Promise<PartyCredit[]> {
  const po = await loadPo(poId);
  const rows = await query<VendorCreditBalance & { origin_po_id: string; origin_po_number: string }>(
    CREDITS_FOR_PARTY,
    [po.supplier_id, po.vendor_id, po.id]
  );
  return rows.map((row) => ({ ...row, remaining: creditRemaining(row), expired: isCreditExpired(row, today) }));
}

export async function applyVendorCredits(opts: {
  purchaseOrderId: string;
  amount: number;
  actor: AuditActor & { id: string };
  dryRun?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ allocations: CreditAllocation[]; remaining: number }> {
  if (!(opts.amount > 0)) throw new CreditApplyError(400, "Jumlah kredit yang dipakai harus lebih dari 0");
  const po = await loadPo(opts.purchaseOrderId);
  const today = todayJakarta();

  return withTransaction(async (client) => {
    const { rows } = await client.query<VendorCreditBalance>(`${CREDITS_FOR_PARTY} FOR UPDATE OF vc`, [
      po.supplier_id,
      po.vendor_id,
      po.id,
    ]);
    const result = allocateCredits(rows, opts.amount, today);
    if (result.allocations.length === 0) {
      throw new CreditApplyError(409, "Tidak ada kredit vendor yang masih berlaku untuk pemasok ini");
    }
    if (opts.dryRun) return result;

    for (const allocation of result.allocations) {
      await client.query(
        `INSERT INTO purchasing.vendor_credit_applications (vendor_credit_id, purchase_order_id, amount, applied_by)
         VALUES ($1, $2, $3, $4)`,
        [allocation.credit_id, po.id, allocation.amount, opts.actor.id]
      );
      await client.query(
        `UPDATE purchasing.vendor_credits
            SET applied_amount = applied_amount + $2, updated_at = now()
          WHERE id = $1`,
        [allocation.credit_id, allocation.amount]
      );
    }

    await recordAudit(client, {
      actor: opts.actor,
      action: "vendor_credit.apply",
      entity: "purchase_order",
      entityId: po.id,
      entityLabel: po.nomor_po,
      after: { requested: opts.amount, allocations: result.allocations, uncovered: result.remaining },
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
    return result;
  });
}
