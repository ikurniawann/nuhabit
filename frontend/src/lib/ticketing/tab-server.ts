import "server-only";
// Fase C (EPIC-023): jembatan kasir POS → ledger tab ticketing.
// Order F&B dibayar "NFC Tab" tidak menerima uang — tagihannya pindah jadi
// baris `fnb` di ticket_visit_charges (referensi pos_order_id).

import { query, withTransaction } from "@/lib/db";
import { normalizeNfcUid } from "./server";
import { canCharge, computeTabSummary } from "./tab";

export interface TabChargeTarget {
  visitId: string;
  bandId: string;
  contactName: string;
  paymentMode: "postpaid" | "prepaid";
  /** Sisa plafon (postpaid) / saldo (prepaid) SEBELUM charge baru. */
  available: number | null;
}

export type TabChargeFailure = {
  ok: false;
  reason: string;
  /** 404 gelang/visit tak ketemu; 409 visit tutup; 402 guard uang gagal. */
  status: 404 | 409 | 402;
};

export type TabChargeSuccess = { ok: true; target: TabChargeTarget };

/**
 * Pratinjau tanpa lock untuk layar pembayaran kasir: gelang ini terikat
 * visit mana, dan apakah tagihan sebesar `amount` bakal lolos guard.
 */
export async function checkTabForCharge(input: {
  bandUid: string;
  amount: number;
  companyId: string;
  branchId: string;
}): Promise<TabChargeSuccess | TabChargeFailure> {
  const uid = normalizeNfcUid(input.bandUid);
  const rows = await query<{
    visit_id: string;
    band_id: string;
    contact_name: string;
    payment_mode: "postpaid" | "prepaid";
    credit_limit: string | null;
    visit_status: string;
  }>(
    `SELECT vb.visit_id, vb.band_id, v.contact_name, v.payment_mode,
            v.credit_limit, v.status AS visit_status
     FROM ticketing.ticket_bands b
     JOIN ticketing.ticket_visit_bands vb
       ON vb.band_id = b.id AND vb.status = 'aktif'
     JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
     WHERE b.branch_id = $1 AND b.company_id = $2 AND b.nfc_uid = $3
     ORDER BY vb.created_at DESC
     LIMIT 1`,
    [input.branchId, input.companyId, uid]
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      reason: "Gelang tidak terikat kunjungan aktif — daftar di loket dulu",
      status: 404,
    };
  }
  if (row.visit_status !== "open") {
    return {
      ok: false,
      reason: "Kunjungan sudah ditutup — tidak bisa menerima charge",
      status: 409,
    };
  }

  const charges = await query<{ direction: "debit" | "kredit"; amount: string }>(
    `SELECT direction, amount FROM ticketing.ticket_visit_charges
     WHERE visit_id = $1`,
    [row.visit_id]
  );
  const summary = computeTabSummary(
    charges.map((c) => ({ direction: c.direction, amount: Number(c.amount) }))
  );
  const creditLimit = row.credit_limit === null ? null : Number(row.credit_limit);
  const guard = canCharge({
    paymentMode: row.payment_mode,
    summary,
    amount: input.amount,
    creditLimit,
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, status: 402 };
  }

  return {
    ok: true,
    target: {
      visitId: row.visit_id,
      bandId: row.band_id,
      contactName: row.contact_name,
      paymentMode: row.payment_mode,
      available:
        row.payment_mode === "prepaid"
          ? summary.saldo
          : creditLimit === null
            ? null
            : Math.round((creditLimit - summary.outstanding) * 100) / 100,
    },
  };
}

/**
 * Tulis tagihan order F&B ke tab visit — transaksional & ber-lock:
 * visit dikunci FOR UPDATE (serialisasi dgn gate tap / settle / top-up),
 * guard mode bayar ditegakkan ulang di dalam lock, lalu baris `fnb`
 * ditulis dengan referensi pos_order_id. Idempotent per order: charge
 * fnb kedua untuk order yang sama ditolak.
 */
export async function chargeFnbOrderToTab(input: {
  orderId: string;
  orderNumber: string;
  amount: number;
  bandUid: string;
  companyId: string;
  branchId: string;
  createdBy: string | null;
  /**
   * true → tandai pos_orders completed/paid DI DALAM transaksi yang sama —
   * charge dan status order tidak mungkin terpisah (atomik, hasil review).
   */
  markOrderPaid?: boolean;
}): Promise<TabChargeSuccess | TabChargeFailure> {
  const uid = normalizeNfcUid(input.bandUid);
  const amount = Math.round(input.amount * 100) / 100;

  return withTransaction(async (client) => {
    const targetResult = await client.query<{
      visit_id: string;
      band_id: string;
      contact_name: string;
      payment_mode: "postpaid" | "prepaid";
      credit_limit: string | null;
      visit_status: string;
    }>(
      `SELECT vb.visit_id, vb.band_id, v.contact_name, v.payment_mode,
              v.credit_limit, v.status AS visit_status
       FROM ticketing.ticket_bands b
       JOIN ticketing.ticket_visit_bands vb
         ON vb.band_id = b.id AND vb.status = 'aktif'
       JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
       WHERE b.branch_id = $1 AND b.company_id = $2 AND b.nfc_uid = $3
       ORDER BY vb.created_at DESC
       LIMIT 1
       FOR UPDATE OF vb, v`,
      [input.branchId, input.companyId, uid]
    );
    const target = targetResult.rows[0];
    if (!target) {
      return {
        ok: false as const,
        reason: "Gelang tidak terikat kunjungan aktif — daftar di loket dulu",
        status: 404 as const,
      };
    }
    if (target.visit_status !== "open") {
      return {
        ok: false as const,
        reason: "Kunjungan sudah ditutup — tidak bisa menerima charge",
        status: 409 as const,
      };
    }

    const dupResult = await client.query(
      `SELECT 1 FROM ticketing.ticket_visit_charges
       WHERE pos_order_id = $1 AND charge_type = 'fnb'
         AND voided_by_charge_id IS NULL
       LIMIT 1`,
      [input.orderId]
    );
    if (dupResult.rows.length > 0) {
      return {
        ok: false as const,
        reason: "Order ini sudah ter-charge ke tab",
        status: 409 as const,
      };
    }

    const chargesResult = await client.query<{
      direction: "debit" | "kredit";
      amount: string;
    }>(
      `SELECT direction, amount FROM ticketing.ticket_visit_charges
       WHERE visit_id = $1`,
      [target.visit_id]
    );
    const summary = computeTabSummary(
      chargesResult.rows.map((c) => ({
        direction: c.direction,
        amount: Number(c.amount),
      }))
    );
    const creditLimit =
      target.credit_limit === null ? null : Number(target.credit_limit);
    const guard = canCharge({
      paymentMode: target.payment_mode,
      summary,
      amount,
      creditLimit,
    });
    if (!guard.ok) {
      return { ok: false as const, reason: guard.reason, status: 402 as const };
    }

    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, band_id, charge_type, direction,
          description, amount, pos_order_id, created_by)
       VALUES ($1, $2, $3, $4, 'fnb', 'debit', $5, $6, $7, $8)`,
      [
        input.companyId,
        input.branchId,
        target.visit_id,
        target.band_id,
        `F&B Order ${input.orderNumber}`,
        amount,
        input.orderId,
        input.createdBy,
      ]
    );

    if (input.markOrderPaid) {
      await client.query(
        `UPDATE pos.pos_orders
         SET payment_status = 'paid', updated_at = now()
         WHERE id = $1`,
        [input.orderId]
      );
    }

    return {
      ok: true as const,
      target: {
        visitId: target.visit_id,
        bandId: target.band_id,
        contactName: target.contact_name,
        paymentMode: target.payment_mode,
        available:
          target.payment_mode === "prepaid"
            ? Math.round((summary.saldo - amount) * 100) / 100
            : creditLimit === null
              ? null
              : Math.round(
                  (creditLimit - summary.outstanding - amount) * 100
                ) / 100,
      },
    };
  });
}

/**
 * Balik charge F&B NFC Tab saat order POS di-void. Append-only + idempoten
 * (baris yang sudah punya pembalik dilewati). Visit tertutup tetap ditulis —
 * void kasir ber-PIN supervisor tidak boleh meninggalkan tagihan tab.
 */
export async function voidFnbOrderFromTab(input: {
  orderId: string;
  reason: string;
  createdBy: string | null;
}): Promise<boolean> {
  return withTransaction(async (client) => {
    const chargeResult = await client.query<{
      id: string;
      company_id: string;
      branch_id: string;
      visit_id: string;
      band_id: string | null;
      description: string;
      amount: string;
    }>(
      `SELECT id, company_id, branch_id, visit_id, band_id, description, amount
         FROM ticketing.ticket_visit_charges
        WHERE pos_order_id = $1 AND charge_type = 'fnb' AND direction = 'debit'
        ORDER BY created_at
        LIMIT 1`,
      [input.orderId]
    );
    const charge = chargeResult.rows[0];
    if (!charge) return false;

    const reversed = await client.query(
      `SELECT 1 FROM ticketing.ticket_visit_charges
        WHERE voided_by_charge_id = $1 LIMIT 1`,
      [charge.id]
    );
    if (reversed.rows.length > 0) return true;

    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, band_id, charge_type, direction,
          description, amount, voided_by_charge_id, created_by)
       VALUES ($1, $2, $3, $4, 'koreksi', 'kredit', $5, $6, $7, $8)`,
      [
        charge.company_id,
        charge.branch_id,
        charge.visit_id,
        charge.band_id,
        `Void POS: ${charge.description} — ${input.reason}`,
        charge.amount,
        charge.id,
        input.createdBy,
      ]
    );
    return true;
  });
}
