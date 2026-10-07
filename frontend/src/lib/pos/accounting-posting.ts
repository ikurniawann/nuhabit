import type { DbClient } from "@/lib/pg/types";
import {
  AccountingPostError,
  postJournalFromMapping,
  type JournalAmountMap,
  type MappingPostResult,
} from "@/lib/accounting/journal-mapping-posting";
import {
  buildPosAccountingAmounts,
  computePosAccountingAmounts,
  mapPaymentMethodToSaleEvent,
} from "@/lib/pos/accounting-amounts";

export { AccountingPostError };
export type { MappingPostResult };

function summarizeResults(results: MappingPostResult[]): string | null {
  const notes: string[] = [];
  for (const result of results) {
    if (result.status === "posted") notes.push("jurnal posted");
    else if (result.status === "draft") {
      notes.push(`jurnal draft: ${result.reason || "mapping belum lengkap"}`);
    } else if (result.status === "skipped" && result.reason !== "already_exists") {
      notes.push(`jurnal dilewati: ${result.reason || "tidak ada mapping"}`);
    }
  }
  if (notes.length === 0) return null;
  return [...new Set(notes)].join("; ");
}

export async function postPosSaleAccountingJournals(opts: {
  db: DbClient;
  orderId: string;
  userId: string;
  paymentMethod?: string | null;
  documentId?: string;
  documentType?: string;
  amountsOverride?: JournalAmountMap;
}): Promise<{ results: MappingPostResult[]; note: string | null }> {
  const built = await buildPosAccountingAmounts(opts.db, opts.orderId);
  const amounts = opts.amountsOverride || built.amounts;
  if ((amounts.TOTAL || 0) <= 0) {
    return {
      results: [{ status: "skipped", reason: "Nilai penjualan 0 — tidak ada jurnal" }],
      note: null,
    };
  }

  const method = opts.paymentMethod ?? built.paymentMethod;
  const saleEvent = mapPaymentMethodToSaleEvent(method);
  if (saleEvent === "SKIP_NFC_TAB") {
    return {
      results: [
        {
          status: "skipped",
          reason: "NFC Tab dipindah ke ticketing AR — jurnal POS dilewati",
        },
      ],
      note: null,
    };
  }
  if (!saleEvent) {
    return {
      results: [
        {
          status: "skipped",
          reason: `Metode pembayaran ${method || "kosong"} tidak punya journal mapping POS`,
        },
      ],
      note: null,
    };
  }

  const documentId = opts.documentId || opts.orderId;
  const documentType = opts.documentType || "pos_order";
  const common = {
    companyId: built.companyId,
    userId: opts.userId,
    documentType,
    documentId,
    entryDate: built.entryDate,
    amounts,
    sourceModule: "POS",
  };

  const saleResult = await postJournalFromMapping({
    ...common,
    eventCode: saleEvent,
    description: `POS ${built.orderNumber} — penjualan ${method || saleEvent}`,
  });

  const results: MappingPostResult[] = [saleResult];
  if ((amounts.COGS || 0) > 0) {
    const cogsResult = await postJournalFromMapping({
      ...common,
      eventCode: "POS_COGS_RELIEF",
      description: `POS ${built.orderNumber} — HPP / relief inventory`,
    });
    results.push(cogsResult);
  }

  return { results, note: summarizeResults(results) };
}

export function buildSplitAccountingAmounts(input: {
  subtotal: number;
  discount_amount?: number | null;
  tax_amount?: number | null;
  total_amount: number;
  amount_paid?: number | null;
  orderTotal: number;
  orderCogs: number;
  service_charge_amount?: number | null;
  other_charges_amount?: number | null;
}): JournalAmountMap {
  const ratio =
    input.orderTotal > 0
      ? Math.max(0, Number(input.total_amount) || 0) / input.orderTotal
      : 0;
  return computePosAccountingAmounts({
    subtotal: input.subtotal,
    discount_amount: input.discount_amount,
    tax_amount: input.tax_amount,
    service_charge_amount: (Number(input.service_charge_amount) || 0) * ratio,
    other_charges_amount: (Number(input.other_charges_amount) || 0) * ratio,
    total_amount: input.total_amount,
    amount_paid: input.amount_paid,
    cogs: (Number(input.orderCogs) || 0) * ratio,
  });
}
