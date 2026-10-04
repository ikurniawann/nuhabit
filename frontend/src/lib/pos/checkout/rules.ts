// Aturan murni checkout gabungan: guard keranjang, tender, pembagian ke stall,
// dan rencana penjualan sebelum menyentuh DB.
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
  allocateAmount,
  allocateCheckoutCharges,
  shouldCreateCheckout,
  uniqueStallIds,
} from "@/lib/pos/central-cashier";
import { normalizeGuestCount } from "@/lib/pos/guest-count";
import {
  CHECKOUT_CANCELLED_NOTE,
  CHECKOUT_CANCEL_HAS_CHILDREN_MESSAGE,
  CHECKOUT_CANCEL_PAID_MESSAGE,
  CHECKOUT_QRIS_MISSING_MESSAGE,
  CHECKOUT_QRIS_UNPAID_MESSAGE,
  MISSING_PRODUCT_STALL_MESSAGE,
  MIXED_STALL_FORBIDDEN_MESSAGE,
  MULTI_STALL_REQUIRED_MESSAGE,
  MixedCheckoutError,
  type BuiltLine,
  type CheckoutRow,
  type CompleteMixedCheckoutTender,
  type CreateMixedCheckoutInput,
  type MixedCheckoutCartSnapshot,
  type MixedCheckoutGuardResult,
  type MixedCheckoutItem,
  type StallSlice,
  type XenditPaidWebhookAction,
} from "./types";

export function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function lineItemSubtotal(item: MixedCheckoutItem): number {
  const qty = toNumber(item.quantity, 1) || 1;
  const unit = toNumber(item.unit_price);
  const variantAdj = toNumber(item.variant_price_adjustment);
  const modifierAdj = toNumber(item.modifier_price_adjustment);
  return (unit + variantAdj + modifierAdj) * qty;
}

/**
 * Promo tetap ditolak untuk checkout multi-stall: engine promo bekerja per
 * order tunggal dan belum punya aturan pembagian antar stall.
 *
 * Diskon transaksi (mis. diskon manual kasir) TIDAK ditolak — nilainya dibagi
 * pro-rata ke tiap stall oleh `allocateCheckoutCharges` berdasarkan subtotal,
 * dengan sisa pembulatan jatuh ke stall bersubtotal terbesar.
 */
export function rejectMixedPromo(input: {
  promoCode?: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (String(input.promoCode || "").trim()) {
    return { ok: false, message: MIXED_PROMO_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}

export function guardMixedCheckoutCart(input: {
  productIds: string[];
  warehouseByProduct: Map<string, string | null>;
  canSellMixed: boolean;
  hasSplits?: boolean;
  promoCode?: string | null;
}): MixedCheckoutGuardResult {
  for (const id of input.productIds) {
    const warehouseId = input.warehouseByProduct.get(id);
    if (!warehouseId) {
      return { ok: false, message: MISSING_PRODUCT_STALL_MESSAGE };
    }
  }

  const stallIds = uniqueStallIds(
    input.productIds.map((id) => input.warehouseByProduct.get(id) ?? null)
  );

  if (shouldCreateCheckout(stallIds) && !input.canSellMixed) {
    return { ok: false, message: MIXED_STALL_FORBIDDEN_MESSAGE };
  }
  if (shouldCreateCheckout(stallIds) && input.hasSplits) {
    return { ok: false, message: MIXED_SPLIT_UNSUPPORTED_MESSAGE };
  }
  if (shouldCreateCheckout(stallIds)) {
    const promoGuard = rejectMixedPromo({ promoCode: input.promoCode });
    if (!promoGuard.ok) return promoGuard;
  }

  return {
    ok: true,
    createCheckout: shouldCreateCheckout(stallIds),
    stallIds,
  };
}

export function groupItemsByStall<T>(
  items: T[],
  warehouseOf: (item: T) => string | null | undefined
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const warehouseId = warehouseOf(item);
    if (!warehouseId) continue;
    const list = grouped.get(warehouseId) ?? [];
    list.push(item);
    grouped.set(warehouseId, list);
  }
  return grouped;
}

/** Baris → potongan per stall, urut kemunculan stall pertama. */
export function sliceLinesByStall(lines: BuiltLine[]): StallSlice[] {
  const grouped = groupItemsByStall(lines, (line) => line.warehouseId);
  return [...grouped.entries()].map(([warehouseId, stallLines]) => ({
    warehouseId,
    subtotal: stallLines.reduce((sum, line) => sum + line.lineSubtotal, 0),
    lines: stallLines,
  }));
}

/** Bagi diskon/pajak/service/biaya lain checkout ke tiap potongan stall. */
export function allocateSliceCharges(
  slices: StallSlice[],
  charges: { discount: number; tax: number; serviceCharge: number; otherCharges: number }
) {
  return allocateCheckoutCharges({
    slices: slices.map((slice) => ({ warehouseId: slice.warehouseId, subtotal: slice.subtotal })),
    ...charges,
  });
}

export function shouldInsertCheckoutChildren(input: {
  paymentMethod: string;
  paymentStatus?: string | null;
  amountPaid: number;
  total: number;
}): boolean {
  if (String(input.paymentStatus || "").toLowerCase() === "unpaid") return false;
  if (input.paymentMethod === "qris" && input.amountPaid < input.total) return false;
  return true;
}

/** Pay-now gabungan (bukan open bill) langsung completed. Open bill tetap pending untuk KDS. */
export function resolveCheckoutChildOrderStatus(input: {
  paymentStatus?: string | null;
  isOpenBill: boolean;
}): "pending" | "completed" {
  const paid = String(input.paymentStatus || "").toLowerCase() === "paid";
  if (paid && !input.isOpenBill) return "completed";
  return "pending";
}

export function resolveOrderSoldFrom(input: { isCentralCashier: boolean }): "central" | "stall" {
  return input.isCentralCashier ? "central" : "stall";
}

export function shouldReuseCheckoutQris(checkout: {
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
}): boolean {
  return resolveCheckoutQrisAction(checkout) !== "create";
}

export function resolveCheckoutQrisAction(checkout: {
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
}): "reuse_qr_id" | "lookup_external_id" | "create" {
  if (checkout.xendit_qr_id) return "reuse_qr_id";
  if (checkout.xendit_external_id) return "lookup_external_id";
  return "create";
}

export function rejectUnsupportedMixedTender(
  paymentMethod: string
): { ok: true } | { ok: false; message: string } {
  if (paymentMethod === "nfc_tab" || paymentMethod === "gift_card") {
    return { ok: false, message: MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}

export function resolveLineWarehouse(
  item: MixedCheckoutItem,
  warehouseByProduct: Map<string, string | null>
): string {
  const productId = String(item.product_id || "");
  return warehouseByProduct.get(productId) || "";
}

export function allocateCheckoutTender(amountPaid: number, childTotals: number[]): number[] {
  return allocateAmount(amountPaid, childTotals);
}

export function settleMixedCheckoutTender(input: {
  totalAmount: number;
  amountPaid?: number;
}): { amountPaid: number; changeAmount: number } {
  const amountPaid =
    input.amountPaid != null && Number.isFinite(input.amountPaid)
      ? input.amountPaid
      : input.totalAmount;
  return {
    amountPaid,
    changeAmount: Math.max(0, amountPaid - input.totalAmount),
  };
}

const CHECKOUT_BILL_METHODS = new Set(["cash", "qris", "credit", "debit", "credit_card"]);

export function resolveCheckoutBillTender(input: {
  paymentMethod?: string | null;
  amountPaid?: number | null;
  totalAmount: number;
}):
  | { ok: true; paymentMethod: string; amountPaid: number; changeAmount: number }
  | { ok: false; message: string } {
  const raw = String(input.paymentMethod || "").trim();
  if (!raw) {
    return { ok: false, message: "Metode pembayaran wajib" };
  }
  const unsupported = rejectUnsupportedMixedTender(raw);
  if (!unsupported.ok) return unsupported;
  if (raw === "ark_coin") {
    return { ok: false, message: MIXED_ARK_UNSUPPORTED_MESSAGE };
  }
  const paymentMethod = raw === "credit_card" ? "credit" : raw;
  if (!CHECKOUT_BILL_METHODS.has(raw) && !CHECKOUT_BILL_METHODS.has(paymentMethod)) {
    return { ok: false, message: "Metode pembayaran tidak didukung untuk tagihan checkout" };
  }
  if (input.amountPaid == null || !Number.isFinite(Number(input.amountPaid))) {
    return { ok: false, message: "Nominal pembayaran wajib" };
  }
  const settled = settleMixedCheckoutTender({
    totalAmount: input.totalAmount,
    amountPaid: Number(input.amountPaid),
  });
  if (settled.amountPaid < input.totalAmount) {
    return { ok: false, message: "Nominal tunai kurang dari total tagihan" };
  }
  return { ok: true, paymentMethod, ...settled };
}

export function assertCheckoutQrisReadyToComplete(input: {
  xenditQrId?: string | null;
  xenditExternalId?: string | null;
  paid: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (!input.xenditQrId && !input.xenditExternalId) {
    return { ok: false, message: CHECKOUT_QRIS_MISSING_MESSAGE };
  }
  if (!input.paid) {
    return { ok: false, message: CHECKOUT_QRIS_UNPAID_MESSAGE };
  }
  return { ok: true };
}

export function shouldSyncCustomerStatsOnFinalize(input: {
  alreadyHadChildren: boolean;
}): boolean {
  return !input.alreadyHadChildren;
}

export function resolveXenditPaidWebhookAction(input: {
  topupId?: string | null;
  checkoutId?: string | null;
  childCount: number;
  // Bug #2 fix (insiden 2026-08-25): QRIS yang diikat ke SATU order open
  // bill (bukan checkout gabungan) — webhook sebelumnya tidak punya jalur
  // untuk kasus ini sama sekali, cuma bisa "ignore".
  orderId?: string | null;
}): XenditPaidWebhookAction {
  if (input.topupId) return { type: "credit_topup" };
  const checkoutId = String(input.checkoutId || "").trim();
  if (checkoutId) {
    if (input.childCount > 0) return { type: "noop_checkout", checkoutId };
    return { type: "complete_checkout", checkoutId };
  }
  const orderId = String(input.orderId || "").trim();
  if (orderId) return { type: "complete_order", orderId };
  return { type: "ignore" };
}

export function mustConfirmStoredCheckoutQris(input: {
  paymentMethod: string;
  paymentAlreadyConfirmed?: boolean;
  hasExistingChildren?: boolean;
}): boolean {
  return input.paymentMethod === "qris" && !input.paymentAlreadyConfirmed;
}

export function isCancelledCheckout(input: { notes?: string | null }): boolean {
  return String(input.notes || "").trim().toLowerCase().startsWith(CHECKOUT_CANCELLED_NOTE);
}

export function canCancelUnpaidChildlessCheckout(input: {
  paymentStatus?: string | null;
  childCount: number;
  notes?: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (isCancelledCheckout({ notes: input.notes })) {
    return { ok: true };
  }
  if (String(input.paymentStatus || "unpaid").toLowerCase() === "paid") {
    return { ok: false, message: CHECKOUT_CANCEL_PAID_MESSAGE };
  }
  if (input.childCount > 0) {
    return { ok: false, message: CHECKOUT_CANCEL_HAS_CHILDREN_MESSAGE };
  }
  return { ok: true };
}

export function unpaidChildlessCheckoutCancelPatch(): {
  table_id: null;
  notes: string;
} {
  return { table_id: null, notes: CHECKOUT_CANCELLED_NOTE };
}

export function unpaidCheckoutScopeSql(input: {
  companyId?: string | null;
  branchId?: string | null;
  startParam: number;
}): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  let index = input.startParam;
  if (input.companyId) {
    parts.push(`company_id = $${index++}`);
    params.push(input.companyId);
  }
  if (input.branchId) {
    parts.push(`branch_id = $${index++}`);
    params.push(input.branchId);
  }
  return {
    sql: parts.map((part) => ` AND ${part}`).join(""),
    params,
  };
}

export function resolveCompleteCheckoutTender(input: {
  tender?: CompleteMixedCheckoutTender;
  storedPaymentMethod?: string | null;
  totalAmount: number;
}): { paymentMethod: string | null; amountPaid: number } {
  const tender = input.tender || {};
  const paymentMethod = String(tender.paymentMethod || input.storedPaymentMethod || "").trim() || null;
  const amountPaid =
    tender.amountPaid != null && Number.isFinite(Number(tender.amountPaid))
      ? Number(tender.amountPaid)
      : input.totalAmount;
  return { paymentMethod, amountPaid };
}

export function buildLines(
  items: MixedCheckoutItem[],
  warehouseByProduct: Map<string, string | null>
): BuiltLine[] {
  return items.map((item) => {
    const warehouseId = resolveLineWarehouse(item, warehouseByProduct);
    const qty = toNumber(item.quantity, 1) || 1;
    const unitPrice =
      toNumber(item.unit_price) +
      toNumber(item.variant_price_adjustment) +
      toNumber(item.modifier_price_adjustment);
    const lineSubtotal = unitPrice * qty;
    const lineDiscount = Math.max(0, toNumber(item.discount_amount));
    return {
      ...item,
      warehouseId,
      qty,
      unitPrice,
      lineSubtotal,
      lineDiscount,
      lineTotal: Math.max(0, lineSubtotal - lineDiscount),
    };
  });
}

export function snapshotFromInput(
  input: CreateMixedCheckoutInput,
  lines: BuiltLine[]
): MixedCheckoutCartSnapshot {
  const warehouseByProduct: Record<string, string> = {};
  for (const line of lines) {
    if (line.product_id) warehouseByProduct[line.product_id] = line.warehouseId;
  }
  return {
    items: lines.map((line) => ({
      ...line,
      warehouse_id: line.warehouseId,
    })),
    warehouseByProduct,
    orderType: input.orderType || "dine_in",
    guestCount: normalizeGuestCount(input.guestCount),
    notes: input.notes || null,
    specialRequests: input.specialRequests || null,
    chargesBreakdown: Array.isArray(input.chargesBreakdown) ? input.chargesBreakdown : [],
    cashierId: input.cashierId,
    serverId: input.serverId || null,
    sessionUserId: input.sessionUserId,
    discountReason: input.discountReason || null,
  };
}

/** cart_snapshot bisa datang sebagai jsonb (objek) atau teks JSON. */
export function parseSnapshot(checkout: Pick<CheckoutRow, "cart_snapshot">): MixedCheckoutCartSnapshot | null {
  const raw = checkout.cart_snapshot as unknown;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as MixedCheckoutCartSnapshot;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as MixedCheckoutCartSnapshot;
  return null;
}

export type MixedSalePlan = {
  lines: BuiltLine[];
  canCreateFreshCheckout: boolean;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  otherChargesAmount: number;
  serverSubtotal: number;
  serverTotal: number;
  paymentMethod: string;
  amountPaid: number;
  arkUsed: number;
  changeAmount: number;
  requestedUnpaid: boolean;
  insertChildren: boolean;
  paymentStatus: "paid" | "unpaid";
  isPaidSale: boolean;
  snapshot: MixedCheckoutCartSnapshot;
};

/**
 * Langkah 1 checkout gabungan (murni): validasi keranjang & tender, hitung
 * total server dan status bayar. Melempar MixedCheckoutError dengan urutan
 * pemeriksaan yang sama dengan sebelum refactor.
 */
export function planMixedSale(input: CreateMixedCheckoutInput): MixedSalePlan {
  const lines = buildLines(input.items, input.warehouseByProduct);
  if (lines.some((line) => !line.warehouseId)) {
    throw new MixedCheckoutError(MISSING_PRODUCT_STALL_MESSAGE);
  }

  const stallIds = uniqueStallIds(lines.map((line) => line.warehouseId));
  const canCreateFreshCheckout = shouldCreateCheckout(stallIds);
  if (
    !canCreateFreshCheckout &&
    !input.reuseUnpaidTableCheckout &&
    !input.tableId &&
    !input.existingCheckoutId
  ) {
    throw new MixedCheckoutError(MULTI_STALL_REQUIRED_MESSAGE);
  }

  const slices = sliceLinesByStall(lines);
  const discountAmount = toNumber(input.discountAmount);
  const taxAmount = toNumber(input.taxAmount);
  const serviceChargeAmount = toNumber(input.serviceChargeAmount);
  const otherChargesAmount = toNumber(input.otherChargesAmount);
  const promoGuard = rejectMixedPromo({ promoCode: input.promoCode });
  if (promoGuard.ok === false) {
    throw new MixedCheckoutError(promoGuard.message);
  }
  if (lines.some((line) => line.lineDiscount > 0)) {
    throw new MixedCheckoutError(MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE);
  }
  const allocated = allocateSliceCharges(slices, {
    discount: discountAmount,
    tax: taxAmount,
    serviceCharge: serviceChargeAmount,
    otherCharges: otherChargesAmount,
  });
  const serverSubtotal = slices.reduce((sum, slice) => sum + slice.subtotal, 0);
  const serverTotal = allocated.reduce((sum, row) => sum + row.total, 0);
  const paymentMethod = input.paymentMethod || "cash";
  const tenderGuard = rejectUnsupportedMixedTender(paymentMethod);
  if (!tenderGuard.ok) {
    throw new MixedCheckoutError(tenderGuard.message);
  }
  const amountPaid = toNumber(input.amountPaid);
  const arkUsed = toNumber(input.arkCoinsUsed);
  const requestedUnpaid = String(input.paymentStatus || "").toLowerCase() === "unpaid";
  const insertChildren =
    Boolean(input.forceInsertChildren) ||
    shouldInsertCheckoutChildren({
      paymentMethod,
      paymentStatus: input.paymentStatus,
      amountPaid: amountPaid + arkUsed,
      total: serverTotal,
    });
  const paymentStatus = requestedUnpaid ? "unpaid" : insertChildren ? "paid" : "unpaid";
  const isPaidSale = paymentStatus === "paid";

  if (isPaidSale && amountPaid + arkUsed < serverTotal) {
    throw new MixedCheckoutError("Payment insufficient");
  }
  if (paymentMethod === "ark_coin") {
    if (!input.customerId) {
      throw new MixedCheckoutError("Pembayaran ARK Coin membutuhkan customer");
    }
    if (arkUsed < serverTotal) {
      throw new MixedCheckoutError("Pembayaran ARK Coin harus menutup seluruh total order");
    }
  }

  return {
    lines,
    canCreateFreshCheckout,
    discountAmount,
    taxAmount,
    serviceChargeAmount,
    otherChargesAmount,
    serverSubtotal,
    serverTotal,
    paymentMethod,
    amountPaid,
    arkUsed,
    changeAmount: Math.max(0, amountPaid + arkUsed - serverTotal),
    requestedUnpaid,
    insertChildren,
    paymentStatus,
    isPaidSale,
    snapshot: snapshotFromInput(input, lines),
  };
}
