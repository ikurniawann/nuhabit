import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

const QTY_EPSILON = 0.01;

function toAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Unfulfilled PO value: Σ max(0, ordered − received) × unit price.
 * Source of truth for invoice reject/shortage credit (not per-GRN vendor credit approvals).
 */
export function computePoShortageAmount(
  items: Array<{
    qty_ordered?: number | null;
    qty_received?: number | null;
    harga_satuan?: number | null;
  }>
): number {
  return roundAmount(
    items.reduce((sum, item) => {
      const shortage = Math.max(0, toQty(item.qty_ordered) - toQty(item.qty_received));
      return sum + shortage * toAmount(item.harga_satuan);
    }, 0)
  );
}

export async function getPoShortageAmount(db: DbClient, poId: string): Promise<number> {
  const { data, error } = await db
    .from("purchase_order_items")
    .select("qty_ordered, qty_received, harga_satuan")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (error) throw error;
  return computePoShortageAmount(data || []);
}

export type PoPayableContext = {
  /**
   * Kolom pihak terutang: PO F&B memakai `supplier_id`, PO product/general
   * memakai `vendor_id`. Tepat satu yang terisi (lihat *_party_check di DB).
   */
  supplierId: string | null;
  vendorId: string | null;
  grossPayableAmount: number;
  returnCreditAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
};

/**
 * Kolom pihak terutang untuk di-insert ke purchase_order_payment_terms /
 * vendor_payments — meniru pola party_check (supplier XOR vendor).
 */
export type PoPaymentParty = { supplier_id: string | null; vendor_id: string | null };

export function resolvePoPaymentParty(ctx: {
  supplierId: string | null;
  vendorId: string | null;
}): PoPaymentParty {
  if (ctx.vendorId) return { supplier_id: null, vendor_id: ctx.vendorId };
  if (ctx.supplierId) return { supplier_id: ctx.supplierId, vendor_id: null };
  throw ApiError.badRequest("Purchase order has no supplier or vendor assigned");
}

export type PoInvoiceAmounts = {
  gross_payable_amount: number;
  return_credit_amount: number;
  reject_credit_amount: number;
  total_credit_amount: number;
  payable_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_progress_pct: number;
  payment_status: "unpaid" | "partial" | "paid" | "overdue";
};

export function computePoInvoiceAmounts(params: {
  grossPayable: number;
  returnCredit?: number;
  rejectCredit?: number;
  totalCredit?: number;
  paidAmount: number;
  nextDueDate?: string | null;
}): PoInvoiceAmounts {
  const grossPayable = Math.max(0, toAmount(params.grossPayable));
  const returnCredit = Math.max(0, toAmount(params.returnCredit));
  const rejectCredit = Math.max(0, toAmount(params.rejectCredit));
  const totalCredit =
    params.totalCredit !== undefined
      ? Math.max(0, toAmount(params.totalCredit))
      : returnCredit + rejectCredit;
  const paidAmount = Math.max(0, toAmount(params.paidAmount));
  const payableAmount = Math.max(0, grossPayable - totalCredit);
  const outstandingAmount = Math.max(0, payableAmount - paidAmount);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = params.nextDueDate ? new Date(`${params.nextDueDate}T00:00:00`) : null;

  let payment_status: PoInvoiceAmounts["payment_status"];
  if (payableAmount <= QTY_EPSILON || outstandingAmount <= QTY_EPSILON) {
    payment_status = "paid";
  } else if (paidAmount > 0) {
    payment_status = "partial";
  } else if (dueDate && dueDate < today) {
    payment_status = "overdue";
  } else {
    payment_status = "unpaid";
  }

  const payment_progress_pct =
    payableAmount <= QTY_EPSILON
      ? 100
      : Math.min(100, Math.round((paidAmount / payableAmount) * 10000) / 100);

  return {
    gross_payable_amount: grossPayable,
    return_credit_amount: returnCredit,
    reject_credit_amount: rejectCredit,
    total_credit_amount: totalCredit,
    payable_amount: payableAmount,
    paid_amount: paidAmount,
    outstanding_amount: outstandingAmount,
    payment_progress_pct,
    payment_status,
  };
}

export async function getPoReturnCreditAmount(db: DbClient, poId: string): Promise<number> {
  const { data: grns, error: grnError } = await db
    .from("grn")
    .select("id")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (grnError) throw grnError;

  const grnIds = ((grns ?? []) as Array<{ id: string | null }>)
    .map((row) => row.id)
    .filter(Boolean) as string[];
  if (!grnIds.length) return 0;

  const { data: returns, error } = await db
    .from("purchase_returns")
    .select("total_amount")
    .in("grn_id", grnIds)
    .in("status", ["approved", "completed"]);

  if (error) throw error;

  return ((returns ?? []) as Array<{ total_amount: unknown }>).reduce(
    (sum, row) => sum + toAmount(row.total_amount),
    0
  );
}

export async function getReturnCreditsByPoIds(
  db: DbClient,
  poIds: string[]
): Promise<Map<string, number>> {
  const credits = new Map<string, number>();
  if (!poIds.length) return credits;

  const { data: grns, error: grnError } = await db
    .from("grn")
    .select("id, purchase_order_id")
    .in("purchase_order_id", poIds)
    .eq("is_active", true);

  if (grnError) throw grnError;

  const grnToPo = new Map<string, string>();
  const grnIds: string[] = [];
  for (const grn of grns || []) {
    if (!grn.id || !grn.purchase_order_id) continue;
    grnToPo.set(grn.id, grn.purchase_order_id);
    grnIds.push(grn.id);
  }

  if (!grnIds.length) return credits;

  const { data: returns, error } = await db
    .from("purchase_returns")
    .select("grn_id, total_amount")
    .in("grn_id", grnIds)
    .in("status", ["approved", "completed"]);

  if (error) throw error;

  for (const row of returns || []) {
    if (!row.grn_id) continue;
    const poId = grnToPo.get(row.grn_id);
    if (!poId) continue;
    credits.set(poId, (credits.get(poId) || 0) + toAmount(row.total_amount));
  }

  return credits;
}

export async function getPoCreditBreakdown(db: DbClient, poId: string) {
  try {
    const [returnCredit, shortageCredit] = await Promise.all([
      getPoReturnCreditAmount(db, poId),
      getPoShortageAmount(db, poId),
    ]);

    return {
      return_credit_amount: returnCredit,
      reject_credit_amount: shortageCredit,
      total_credit_amount: returnCredit + shortageCredit,
    };
  } catch (error) {
    console.error("[getPoCreditBreakdown] falling back to return credits only:", error);
    const returnCredit = await getPoReturnCreditAmount(db, poId);
    return {
      return_credit_amount: returnCredit,
      reject_credit_amount: 0,
      total_credit_amount: returnCredit,
    };
  }
}

export async function getPoPayableContext(
  db: DbClient,
  poId: string
): Promise<PoPayableContext | null> {
  const { data: po, error: poError } = await db
    .from("purchase_orders")
    .select("id, supplier_id, vendor_id, total, subtotal, diskon_nominal, ppn_nominal")
    .eq("id", poId)
    .maybeSingle();

  if (poError) throw poError;
  if (!po) return null;

  const { data: viewRow, error: viewError } = await db
    .from("v_purchase_orders")
    .select("payable_amount, paid_amount, outstanding_amount, next_due_date")
    .eq("id", poId)
    .maybeSingle();

  if (viewError) throw viewError;

  const grossPayableAmount = toAmount(viewRow?.payable_amount ?? po.total ?? po.subtotal);
  const creditBreakdown = await getPoCreditBreakdown(db, poId);
  const paidAmount = toAmount(viewRow?.paid_amount);
  const amounts = computePoInvoiceAmounts({
    grossPayable: grossPayableAmount,
    returnCredit: creditBreakdown.return_credit_amount,
    rejectCredit: creditBreakdown.reject_credit_amount,
    paidAmount,
    nextDueDate: viewRow?.next_due_date as string | null | undefined,
  });

  return {
    supplierId: (po.supplier_id as string | null) ?? null,
    vendorId: (po.vendor_id as string | null) ?? null,
    grossPayableAmount,
    returnCreditAmount: creditBreakdown.total_credit_amount,
    payableAmount: amounts.payable_amount,
    paidAmount: amounts.paid_amount,
    outstandingAmount: amounts.outstanding_amount,
  };
}

export function resolvePaymentTermLabel(
  amount: number,
  outstandingAmount: number,
  termIndex: number
): string {
  if (amount >= outstandingAmount - QTY_EPSILON) {
    return "Paid in Full";
  }
  return termIndex <= 1 ? "Installment 1" : `Installment ${termIndex}`;
}

export async function resolvePaymentTermId(
  db: DbClient,
  poId: string,
  amount: number,
  paymentDate: string,
  explicitTermId?: string | null
): Promise<string> {
  const ctx = await getPoPayableContext(db, poId);
  if (!ctx) {
    throw new Error("Purchase order not found");
  }
  const party = resolvePoPaymentParty(ctx);

  if (amount > ctx.outstandingAmount + QTY_EPSILON) {
    throw new Error(
      `Payment amount cannot exceed outstanding balance (${ctx.outstandingAmount})`
    );
  }

  if (explicitTermId) {
    const { data: term, error } = await db
      .from("purchase_order_payment_terms")
      .select("id, amount, paid_amount, status, purchase_order_id")
      .eq("id", explicitTermId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!term || term.purchase_order_id !== poId) {
      throw new Error("Payment term not found for this purchase order");
    }

    const termRemaining = Math.max(0, toAmount(term.amount) - toAmount(term.paid_amount));
    if (amount > termRemaining + QTY_EPSILON) {
      throw new Error(
        `Payment amount exceeds the remaining balance for this term (${termRemaining})`
      );
    }

    return explicitTermId;
  }

  const { data: terms, error: termsError } = await db
    .from("purchase_order_payment_terms")
    .select("id, amount, paid_amount, status, term_no")
    .eq("purchase_order_id", poId)
    .eq("is_active", true)
    .order("term_no", { ascending: true });

  if (termsError) throw termsError;

  const activeTerms = (terms ?? []) as Array<{
    id: string;
    amount: unknown;
    paid_amount: unknown;
    status: string | null;
    term_no: number | null;
  }>;
  const openTerm = activeTerms.find((term) => {
    if (term.status === "paid") return false;
    const remaining = Math.max(0, toAmount(term.amount) - toAmount(term.paid_amount));
    return remaining + QTY_EPSILON >= amount;
  });

  if (openTerm?.id) {
    return openTerm.id;
  }

  const nextTermNo = activeTerms.reduce((max, term) => Math.max(max, Number(term.term_no || 0)), 0) + 1;
  const description = resolvePaymentTermLabel(amount, ctx.outstandingAmount, nextTermNo);
  const termAmount =
    amount >= ctx.outstandingAmount - QTY_EPSILON ? ctx.outstandingAmount : amount;

  const { data: createdTerm, error: createError } = await db
    .from("purchase_order_payment_terms")
    .insert({
      purchase_order_id: poId,
      supplier_id: party.supplier_id,
      vendor_id: party.vendor_id,
      term_no: nextTermNo,
      description,
      due_date: paymentDate,
      amount: termAmount,
      notes: null,
      status: "unpaid",
    })
    .select("id")
    .single();

  if (createError) throw createError;
  return createdTerm.id as string;
}

export function normalizeTermDescription(
  description: string,
  amount: number,
  payableAmount: number,
  termNo: number
): string {
  const trimmed = description.trim();
  const isFullAmount = amount >= payableAmount - QTY_EPSILON;
  const looksLikeDefaultInstallment =
    /^down payment$/i.test(trimmed) ||
    /^payment term \d+$/i.test(trimmed) ||
    /^termin$/i.test(trimmed);

  if (isFullAmount && (looksLikeDefaultInstallment || termNo === 1)) {
    return "Paid in Full";
  }

  return trimmed || resolvePaymentTermLabel(amount, payableAmount, termNo);
}
