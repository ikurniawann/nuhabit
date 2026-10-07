import type { DbClient } from "@/lib/pg/types";
import {
  AccountingPostError,
  postJournalFromMapping,
  type JournalAmountMap,
  type MappingPostResult,
} from "@/lib/accounting/journal-mapping-posting";
import {
  buildGrnAccountingAmounts,
  buildPaymentAccountingAmounts,
  buildReturnAccountingAmounts,
} from "@/lib/purchasing/accounting-amounts";

export { AccountingPostError };
export type { MappingPostResult };

function summarizeResults(results: MappingPostResult[]): string | null {
  const notes: string[] = [];
  for (const r of results) {
    if (r.status === "posted") notes.push("jurnal posted");
    else if (r.status === "draft") notes.push(`jurnal draft: ${r.reason || "mapping belum lengkap"}`);
    else if (r.status === "skipped" && r.reason !== "already_exists") {
      notes.push(`jurnal dilewati: ${r.reason || "tidak ada mapping"}`);
    }
  }
  if (notes.length === 0) return null;
  return [...new Set(notes)].join("; ");
}

/**
 * After GRN inventory is posted: PURCHASE_GRN, then native AP invoice + PURCHASE_AP_INVOICE.
 * AP invoice journal is keyed by accounting.ap_invoices id (SoT), not grn id.
 * Throws AccountingPostError when mapping is ready but technical/fiscal post fails.
 */
export async function postGrnAccountingJournals(opts: {
  db: DbClient;
  grnId: string;
  userId: string;
}): Promise<{ results: MappingPostResult[]; note: string | null }> {
  const built = await buildGrnAccountingAmounts(opts.db, opts.grnId);
  if ((built.amounts.TOTAL || 0) <= 0) {
    return {
      results: [
        {
          status: "skipped",
          reason: "Nilai GRN 0 — tidak ada jurnal",
        },
      ],
      note: null,
    };
  }

  const grnResult = await postJournalFromMapping({
    companyId: built.companyId,
    userId: opts.userId,
    documentType: "grn",
    documentId: opts.grnId,
    entryDate: built.entryDate,
    amounts: built.amounts,
    sourceModule: "PURCHASING",
    eventCode: "PURCHASE_GRN",
    description: `GRN ${built.nomorGrn} — penerimaan inventory`,
  });

  const { createApInvoiceFromGrn } = await import("@/lib/accounting/ap-store");
  const { postApInvoiceJournal } = await import("@/lib/accounting/ap-posting");

  let apResult: MappingPostResult;
  try {
    const invoice = await createApInvoiceFromGrn({
      db: opts.db,
      grnId: opts.grnId,
      userId: opts.userId,
    });
    const posted = await postApInvoiceJournal({
      companyId: built.companyId,
      userId: opts.userId,
      invoice,
      description: `GRN ${built.nomorGrn} / ${invoice.invoice_no} — pengakuan hutang vendor (AP)`,
    });
    apResult = posted.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat AP invoice";
    apResult = { status: "skipped", reason: message };
  }

  const results = [grnResult, apResult];
  return { results, note: summarizeResults(results) };
}

export async function postPaymentAccountingJournal(opts: {
  companyId: string | null;
  userId: string;
  paymentId: string;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  const amounts: JournalAmountMap = buildPaymentAccountingAmounts(opts.amount);
  if ((amounts.PAID || 0) <= 0) {
    return {
      result: { status: "skipped", reason: "Amount pembayaran 0" },
      note: null,
    };
  }

  const result = await postJournalFromMapping({
    companyId: opts.companyId,
    userId: opts.userId,
    eventCode: "PURCHASE_PAYMENT",
    documentType: "vendor_payment",
    documentId: opts.paymentId,
    entryDate: opts.paymentDate,
    amounts,
    description: `Pembayaran vendor ${opts.paymentNumber}`,
    sourceModule: "PURCHASING",
  });

  return { result, note: summarizeResults([result]) };
}

export async function postReturnAccountingJournal(opts: {
  companyId: string | null;
  userId: string;
  returnId: string;
  returnNumber: string;
  returnDate: string;
  totalAmount: number;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  const amounts = buildReturnAccountingAmounts(opts.totalAmount);
  if ((amounts.TOTAL || 0) <= 0) {
    return {
      result: { status: "skipped", reason: "Nilai retur 0" },
      note: null,
    };
  }

  const result = await postJournalFromMapping({
    companyId: opts.companyId,
    userId: opts.userId,
    eventCode: "PURCHASE_RETURN",
    documentType: "purchase_return",
    documentId: opts.returnId,
    entryDate: opts.returnDate,
    amounts,
    description: `Retur pembelian ${opts.returnNumber}`,
    sourceModule: "PURCHASING",
  });

  return { result, note: summarizeResults([result]) };
}
