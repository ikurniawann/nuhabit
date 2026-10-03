import { withTransaction } from "@/lib/db";
import { recordAudit, type AuditActor } from "@/lib/audit";
import {
  createJournalEntryRecord,
  findJournalEntryBySource,
  softDeleteJournalEntry,
} from "@/lib/accounting/journal-entry-store";

/**
 * Void pembayaran AP yang sudah POSTED (port VoidPayment, NüHabit).
 *
 * Status jadi VOID dengan alasan wajib. Alokasinya ke invoice tetap tersimpan
 * sebagai riwayat, tapi tidak lagi dihitung (outstanding invoice hanya
 * menjumlah pembayaran POSTED), sehingga hutang muncul kembali. Pembayaran
 * vendor terkait ikut void supaya termin PO dihitung ulang (trigger
 * sync_purchase_order_payment_term). Jurnal pembayaran dibalik.
 */

export interface ApPaymentForVoid {
  id: string;
  status: string;
  deleted_at: string | null;
}

export const VOID_REASON_MIN_LENGTH = 5;

/** Aturan void; null = boleh. */
export function evaluateApPaymentVoid(
  payment: ApPaymentForVoid | null,
  reason: string | null | undefined
): { status: 400 | 404 | 409; message: string } | null {
  if (!payment || payment.deleted_at) {
    return { status: 404, message: "Pembayaran AP tidak ditemukan" };
  }
  if ((reason ?? "").trim().length < VOID_REASON_MIN_LENGTH) {
    return { status: 400, message: `Alasan void wajib diisi (minimal ${VOID_REASON_MIN_LENGTH} karakter)` };
  }
  if (payment.status === "VOID") {
    return { status: 409, message: "Pembayaran ini sudah di-void" };
  }
  if (payment.status !== "POSTED") {
    return { status: 409, message: "Hanya pembayaran POSTED yang bisa di-void" };
  }
  return null;
}

export class ApVoidError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

type PaymentRow = ApPaymentForVoid & {
  payment_no: string;
  company_id: string | null;
  amount: string;
  payment_date: string;
  vendor_payment_id: string | null;
};

export async function voidApPayment(opts: {
  paymentId: string;
  reason: string;
  actor: AuditActor & { id: string };
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ payment: PaymentRow; journalNote: string | null }> {
  const reason = opts.reason.trim();
  const payment = await withTransaction(async (client) => {
    const { rows } = await client.query<PaymentRow>(
      `SELECT id, status, deleted_at, payment_no, company_id, amount::text,
              payment_date::text, vendor_payment_id
         FROM accounting.ap_payments WHERE id = $1 FOR UPDATE`,
      [opts.paymentId]
    );
    const current = rows[0] ?? null;
    const rejection = evaluateApPaymentVoid(current, reason);
    if (rejection) throw new ApVoidError(rejection.status, rejection.message);

    const { rows: allocations } = await client.query<{ invoice_id: string; amount: string }>(
      `SELECT invoice_id, amount::text FROM accounting.ap_payment_allocations WHERE payment_id = $1`,
      [opts.paymentId]
    );

    await client.query(
      `UPDATE accounting.ap_payments
          SET status = 'VOID', voided_at = now(), voided_by = $2, void_reason = $3,
              updated_at = now(), updated_by = $2
        WHERE id = $1`,
      [opts.paymentId, opts.actor.id, reason]
    );

    if (current!.vendor_payment_id) {
      await client.query(
        `UPDATE purchasing.vendor_payments
            SET status = 'void', voided_at = now(), voided_by = $2, void_reason = $3,
                updated_at = now(), updated_by = $2
          WHERE id = $1 AND status <> 'void'`,
        [current!.vendor_payment_id, opts.actor.id, reason]
      );
    }

    await recordAudit(client, {
      actor: opts.actor,
      action: "ap_payment.void",
      entity: "ap_payment",
      entityId: opts.paymentId,
      entityLabel: current!.payment_no,
      before: { status: current!.status, amount: Number(current!.amount), allocations },
      after: { status: "VOID", allocations_counted: false },
      reason,
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
    return current!;
  });

  return { payment, journalNote: await reversePaymentJournal(payment, opts.actor.id, reason) };
}

/** Balik jurnal PURCHASE_PAYMENT: draft dihapus, posted dibalik dengan jurnal baru. */
async function reversePaymentJournal(
  payment: PaymentRow,
  userId: string,
  reason: string
): Promise<string | null> {
  try {
    const entry = await findJournalEntryBySource({
      companyId: payment.company_id,
      sourceEventCode: "PURCHASE_PAYMENT",
      sourceDocumentId: payment.id,
    });
    if (!entry) return "tidak ada jurnal pembayaran untuk dibalik";
    if (entry.status !== "POSTED") {
      await softDeleteJournalEntry(entry.id, userId);
      return "jurnal draft pembayaran dihapus";
    }
    const today = new Date().toISOString().slice(0, 10);
    await createJournalEntryRecord({
      userId,
      companyId: payment.company_id,
      entry_date: today,
      description: `Void pembayaran AP ${payment.payment_no}: ${reason}`,
      is_recon: false,
      post: true,
      entry_type: "AUTO",
      source_module: "PURCHASING",
      source_event_code: "PURCHASE_PAYMENT_VOID",
      source_document_type: "ap_payment",
      source_document_id: payment.id,
      lines: entry.lines.map((line, index) => ({
        account_id: line.account_id,
        entry_side: line.entry_side === "DEBIT" ? "CREDIT" : "DEBIT",
        amount: Number(line.amount),
        memo: `Pembalik ${entry.entry_no}`,
        sort_order: index,
      })),
    });
    return "jurnal pembalik diposting";
  } catch (error) {
    console.error("[ap-void] jurnal pembalik gagal:", error);
    return `jurnal pembalik gagal: ${error instanceof Error ? error.message : "kesalahan tidak diketahui"}`;
  }
}
