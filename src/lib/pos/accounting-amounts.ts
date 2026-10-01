import type { DbClient } from "@/lib/pg/types";
import type { JournalAmountMap } from "@/lib/accounting/journal-mapping-posting";
import type { JournalEventCode } from "@/lib/accounting/journal-mapping-types";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Journal entry_date must be YYYY-MM-DD. pg Date objects stringify as "Sun Aug 09…". */
export function toJournalEntryDate(value?: string | Date | null): string {
  if (typeof value === "string" && ISO_DATE.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const parsed =
    value instanceof Date ? value : value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

export type PosSaleEventCode =
  | Extract<
      JournalEventCode,
      | "POS_SALE_CASH"
      | "POS_SALE_QRIS"
      | "POS_SALE_DEBIT"
      | "POS_SALE_CREDIT"
      | "POS_SALE_ARK_COIN"
      | "POS_SALE_GIFT_CARD"
      | "POS_SALE_MEMBER_BILL"
    >;

export type PosSaleEventResult = PosSaleEventCode | "SKIP_NFC_TAB" | null;

export function computePosAccountingAmounts(input: {
  subtotal: number;
  discount_amount?: number | null;
  tax_amount?: number | null;
  service_charge_amount?: number | null;
  other_charges_amount?: number | null;
  total_amount?: number | null;
  amount_paid?: number | null;
  cogs?: number | null;
}): JournalAmountMap {
  const subtotal = round2(Math.max(0, Number(input.subtotal) || 0));
  const discount = round2(Math.max(0, Number(input.discount_amount) || 0));
  const tax = round2(Math.max(0, Number(input.tax_amount) || 0));
  const service = round2(Math.max(0, Number(input.service_charge_amount) || 0));
  const other = round2(Math.max(0, Number(input.other_charges_amount) || 0));
  const serviceCharge = round2(service + other);
  const explicitTotal = Number(input.total_amount);
  const total = round2(
    Number.isFinite(explicitTotal) && input.total_amount != null
      ? Math.max(0, explicitTotal)
      : Math.max(0, subtotal - discount + tax + serviceCharge)
  );
  const paidRaw = Number(input.amount_paid);
  const paid = round2(
    Number.isFinite(paidRaw) && paidRaw > 0 ? paidRaw : total
  );
  const cogs = round2(Math.max(0, Number(input.cogs) || 0));

  return {
    SUBTOTAL: subtotal,
    DISCOUNT: discount,
    TAX: tax,
    SERVICE_CHARGE: serviceCharge,
    TOTAL: total,
    PAID: paid,
    COGS: cogs,
  };
}

export function mapPaymentMethodToSaleEvent(
  method?: string | null
): PosSaleEventResult {
  const value = String(method || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "nfc_tab") return "SKIP_NFC_TAB";
  if (value === "cash") return "POS_SALE_CASH";
  if (value === "qris") return "POS_SALE_QRIS";
  if (value === "debit") return "POS_SALE_DEBIT";
  if (value === "credit" || value === "credit_card") return "POS_SALE_CREDIT";
  if (value === "ark_coin") return "POS_SALE_ARK_COIN";
  if (value === "gift_card") return "POS_SALE_GIFT_CARD";
  // Order member ditutup dari saldo cicilan (POS → Tagihan, 2026-10-01).
  if (value === "member_bill") return "POS_SALE_MEMBER_BILL";
  return null;
}

export async function buildPosAccountingAmounts(
  db: DbClient,
  orderId: string
): Promise<{
  amounts: JournalAmountMap;
  companyId: string | null;
  branchId: string | null;
  entryDate: string;
  orderNumber: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
}> {
  const { data: order, error } = await db
    .from("pos_orders")
    .select(
      "id, order_number, company_id, branch_id, ordered_at, payment_method, payment_status, subtotal, discount_amount, tax_amount, service_charge_amount, other_charges_amount, total_amount, amount_paid"
    )
    .eq("id", orderId)
    .single();

  if (error || !order) {
    throw new Error("Order POS tidak ditemukan untuk posting accounting");
  }

  const { data: items, error: itemsError } = await db
    .from("pos_order_items")
    .select("cost_total")
    .eq("order_id", orderId);

  if (itemsError) throw itemsError;

  const cogs = (items || []).reduce(
    (sum, item) => sum + Math.max(0, Number(item.cost_total) || 0),
    0
  );

  return {
    companyId: (order.company_id as string | null) || null,
    branchId: (order.branch_id as string | null) || null,
    entryDate: toJournalEntryDate(order.ordered_at as string | Date | null),
    orderNumber: String(order.order_number || orderId),
    paymentMethod: (order.payment_method as string | null) || null,
    paymentStatus: (order.payment_status as string | null) || null,
    amounts: computePosAccountingAmounts({
      subtotal: Number(order.subtotal) || 0,
      discount_amount: Number(order.discount_amount) || 0,
      tax_amount: Number(order.tax_amount) || 0,
      service_charge_amount: Number(order.service_charge_amount) || 0,
      other_charges_amount: Number(order.other_charges_amount) || 0,
      total_amount: Number(order.total_amount) || 0,
      amount_paid: Number(order.amount_paid) || 0,
      cogs,
    }),
  };
}
