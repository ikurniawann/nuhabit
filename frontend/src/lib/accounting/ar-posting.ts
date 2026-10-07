import {
  postJournalFromMapping,
  type JournalAmountMap,
  type MappingPostResult,
} from "@/lib/accounting/journal-mapping-posting";
import { buildPaymentAccountingAmounts } from "@/lib/purchasing/accounting-amounts";
import type { ArInvoiceRow } from "@/lib/accounting/ar-types";

function summarize(results: MappingPostResult[]): string | null {
  const notes: string[] = [];
  for (const r of results) {
    if (r.status === "posted") notes.push("jurnal posted");
    else if (r.status === "draft")
      notes.push(`jurnal draft: ${r.reason || "mapping belum lengkap"}`);
    else if (r.status === "skipped" && r.reason !== "already_exists") {
      notes.push(`jurnal dilewati: ${r.reason || "tidak ada mapping"}`);
    }
  }
  return notes.length ? [...new Set(notes)].join("; ") : null;
}

export async function postArInvoiceJournal(opts: {
  companyId: string | null;
  userId: string;
  invoice: Pick<
    ArInvoiceRow,
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
    return { result: { status: "skipped", reason: "Nilai AR 0" }, note: null };
  }
  const result = await postJournalFromMapping({
    companyId: opts.companyId,
    userId: opts.userId,
    eventCode: "SALE_AR_INVOICE",
    documentType: "ar_invoice",
    documentId: opts.invoice.id,
    entryDate: opts.invoice.invoice_date,
    amounts,
    description:
      opts.description ||
      `AR Invoice ${opts.invoice.invoice_no} — pengakuan piutang`,
    sourceModule: "SALES",
  });
  return { result, note: summarize([result]) };
}

export async function postArReceiptJournal(opts: {
  companyId: string | null;
  userId: string;
  receiptId: string;
  receiptNo: string;
  receiptDate: string;
  amount: number;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  const amounts = buildPaymentAccountingAmounts(opts.amount);
  if ((amounts.PAID || 0) <= 0) {
    return {
      result: { status: "skipped", reason: "Amount receipt 0" },
      note: null,
    };
  }
  const result = await postJournalFromMapping({
    companyId: opts.companyId,
    userId: opts.userId,
    eventCode: "SALE_AR_RECEIPT",
    documentType: "ar_receipt",
    documentId: opts.receiptId,
    entryDate: opts.receiptDate,
    amounts,
    description: `AR Receipt ${opts.receiptNo}`,
    sourceModule: "SALES",
  });
  return { result, note: summarize([result]) };
}
