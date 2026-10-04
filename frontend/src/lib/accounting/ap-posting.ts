import {
  postJournalFromMapping,
  type JournalAmountMap,
  type MappingPostResult,
} from "@/lib/accounting/journal-mapping-posting";
import { buildPaymentAccountingAmounts } from "@/lib/purchasing/accounting-amounts";
import type { ApInvoiceRow } from "@/lib/accounting/ap-types";

function summarizeResults(results: MappingPostResult[]): string | null {
  const notes: string[] = [];
  for (const r of results) {
    if (r.status === "posted") notes.push("jurnal posted");
    else if (r.status === "draft")
      notes.push(`jurnal draft: ${r.reason || "mapping belum lengkap"}`);
    else if (r.status === "skipped" && r.reason !== "already_exists") {
      notes.push(`jurnal dilewati: ${r.reason || "tidak ada mapping"}`);
    }
  }
  if (notes.length === 0) return null;
  return [...new Set(notes)].join("; ");
}

export async function postApInvoiceJournal(opts: {
  companyId: string | null;
  userId: string;
  invoice: Pick<
    ApInvoiceRow,
    "id" | "invoice_no" | "invoice_date" | "subtotal" | "tax_amount" | "total_amount"
  >;
  description?: string;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  const amounts: JournalAmountMap = {
    SUBTOTAL: opts.invoice.subtotal,
    TAX: opts.invoice.tax_amount,
    TOTAL: opts.invoice.total_amount,
  };
  if ((amounts.TOTAL || 0) <= 0) {
    return {
      result: { status: "skipped", reason: "Nilai AP invoice 0" },
      note: null,
    };
  }

  const result = await postJournalFromMapping({
    companyId: opts.companyId,
    userId: opts.userId,
    eventCode: "PURCHASE_AP_INVOICE",
    documentType: "ap_invoice",
    documentId: opts.invoice.id,
    entryDate: opts.invoice.invoice_date,
    amounts,
    description:
      opts.description ||
      `AP Invoice ${opts.invoice.invoice_no} — pengakuan hutang vendor`,
    sourceModule: "PURCHASING",
  });

  return { result, note: summarizeResults([result]) };
}

export async function postApPaymentJournal(opts: {
  companyId: string | null;
  userId: string;
  paymentId: string;
  paymentNo: string;
  paymentDate: string;
  amount: number;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  const amounts = buildPaymentAccountingAmounts(opts.amount);
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
    documentType: "ap_payment",
    documentId: opts.paymentId,
    entryDate: opts.paymentDate,
    amounts,
    description: `Pembayaran AP ${opts.paymentNo}`,
    sourceModule: "PURCHASING",
  });

  return { result, note: summarizeResults([result]) };
}
