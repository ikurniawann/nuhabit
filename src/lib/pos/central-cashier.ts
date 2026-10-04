import {
  posCartHasItems,
  type ActiveStallMode,
} from "@/lib/pos/pos-sell-stall";

export const CENTRAL_CASHIER_MENU = "pos.cashier.central";

export function canSellMixedStall(input: {
  hasCentralMenu: boolean;
  canCentralCheckout: boolean;
  activeMode: ActiveStallMode;
}): boolean {
  return (
    input.hasCentralMenu &&
    input.canCentralCheckout &&
    input.activeMode === "all"
  );
}

export function uniqueStallIds(
  warehouseIds: Array<string | null | undefined>
): string[] {
  return [...new Set(warehouseIds.filter((id): id is string => Boolean(id)))];
}

export function shouldCreateCheckout(stallIds: string[]): boolean {
  return uniqueStallIds(stallIds).length >= 2;
}

export const MIXED_SPLIT_UNSUPPORTED_MESSAGE =
  "Split bill belum didukung untuk checkout multi-stall";
export const MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE =
  "Pembayaran NFC Tab / Gift Card belum didukung untuk checkout multi-stall";
export const MIXED_ARK_UNSUPPORTED_MESSAGE =
  "Pembayaran ARK Coin belum didukung untuk tagihan checkout — gunakan tunai, kartu, atau QRIS";
export const MIXED_PROMO_UNSUPPORTED_MESSAGE =
  "Promo belum didukung untuk checkout multi-stall";
export const MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE =
  "Diskon per item belum didukung untuk checkout multi-stall — pakai diskon transaksi";
export const HYDRATED_CHECKOUT_CART_LOCKED_MESSAGE =
  "Tagihan tersimpan — bayar tagihan ini, jangan tambah item baru";

export function resolveAddCatalogItem(input: {
  canSellMixed: boolean;
  existingStallIds: string[];
  incomingWarehouseId: string | null | undefined;
  centralAllMode?: boolean;
  payingExistingCheckout?: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.payingExistingCheckout) {
    return { ok: false, message: HYDRATED_CHECKOUT_CART_LOCKED_MESSAGE };
  }
  if (input.canSellMixed) return { ok: true };
  return canAddItemToSingleStallCart(
    input.existingStallIds,
    input.incomingWarehouseId,
    { centralAllMode: input.centralAllMode }
  );
}

export function resolveCheckoutApi(stallIds: string[]): "checkout" | "order" {
  return shouldCreateCheckout(stallIds) ? "checkout" : "order";
}

export function shouldDisableSplitBill(stallIds: string[]): boolean {
  return shouldCreateCheckout(stallIds);
}

export function shouldDisableMixedPromo(stallIds: string[]): boolean {
  return shouldCreateCheckout(stallIds);
}

export function isMixedUnsupportedTender(method: string): boolean {
  return method === "nfc_tab" || method === "gift_card";
}

export function isCheckoutBillUnsupportedTender(method: string): boolean {
  return isMixedUnsupportedTender(method) || method === "ark_coin";
}

export function buildCheckoutBillPayBody(input: {
  method: string;
  cashReceived?: string;
  total: number;
  paymentMethodCode?: string;
  paymentMethodName?: string;
}): {
  payment_method: string;
  amount_paid: number;
  payment_method_code?: string;
  payment_method_name?: string;
} {
  const payment_method = input.method === "credit_card" ? "credit" : input.method;
  const parsedCash = Number.parseFloat(input.cashReceived || "");
  const amount_paid =
    input.method === "cash" && Number.isFinite(parsedCash) && parsedCash > 0
      ? parsedCash
      : input.total;
  const body: {
    payment_method: string;
    amount_paid: number;
    payment_method_code?: string;
    payment_method_name?: string;
  } = { payment_method, amount_paid };
  if (input.paymentMethodCode) body.payment_method_code = input.paymentMethodCode;
  if (input.paymentMethodName) body.payment_method_name = input.paymentMethodName;
  return body;
}

export function buildPosQrisCreateBody(input: {
  amount: number;
  checkoutId?: string | null;
  /**
   * Insiden 2026-08-23: bayar open bill — QR WAJIB terikat ke order supaya
   * server memaksa nominal = total bill TERSIMPAN, bukan keranjang di layar
   * (keranjang bisa berubah setelah open bill tanpa tersimpan ke DB).
   */
  orderId?: string | null;
}): { amount: number; checkout_id?: string; order_id?: string } {
  if (input.checkoutId) {
    return { checkout_id: input.checkoutId, amount: input.amount };
  }
  if (input.orderId) {
    return { order_id: input.orderId, amount: input.amount };
  }
  return { amount: input.amount };
}

/** QRIS Confirm / auto-settle only after Xendit poll says paid. Mixed also needs checkout_id. */
export function mayConfirmMixedQris(input: {
  isMixedCart: boolean;
  method: string;
  qrisPaid: boolean;
  checkoutId?: string | null;
}): boolean {
  if (input.method !== "qris") return true;
  if (!input.qrisPaid) return false;
  if (input.isMixedCart) return Boolean(input.checkoutId);
  return true;
}

// Bug #3 (insiden 2026-08-25): auto-confirm QRIS sebelumnya retry TANPA
// batas begitu Xendit bilang lunas — kalau settle di server terus gagal
// (mis. total bill berubah setelah QR dibuat), kasir/pelanggan melihat
// "Pembayaran diterima, menyelesaikan…" berputar SELAMANYA meski uang
// sudah masuk. Batasi percobaan otomatis; sisanya kasir yang putuskan.
export const QRIS_MAX_AUTO_CONFIRM_ATTEMPTS = 3;

export function shouldStopQrisAutoRetry(attempts: number): boolean {
  return attempts >= QRIS_MAX_AUTO_CONFIRM_ATTEMPTS;
}

// Bug #5 fix (insiden 2026-08-25): QRIS "jual instan" (bukan open bill,
// bukan checkout multi-stall) sebelumnya membuat order BARU muncul di DB
// setelah pembayaran dikonfirmasi — kalau proses itu gagal (validasi,
// sesi habis, tab ditutup), uang yang sudah diterima Xendit jadi orphan
// tanpa jejak apapun (4 kasus, Rp77.500, hari ini). Fix: order dibuat
// 'unpaid' DULU (mirror pola checkout multi-stall), baru QR diikat ke
// order itu — kalau gagal SETELAH bayar, order tetap ada & bisa
// diselesaikan manual dari Orders, bukan hilang.
export function shouldPrepareOrderForQris(input: {
  method: string;
  isMixedCart: boolean;
  payingOrderId?: string | null;
  hasPreparedOrder: boolean;
}): boolean {
  if (input.method !== "qris") return false;
  if (input.isMixedCart) return false;
  if (input.payingOrderId) return false;
  if (input.hasPreparedOrder) return false;
  return true;
}

/** Keep Confirm disabled for QRIS until poll marks paid — including while QR is still created. */
export function shouldWaitForQrisConfirm(input: {
  method: string;
  qrisPaid: boolean;
}): boolean {
  return input.method === "qris" && !input.qrisPaid;
}

/** Drop the previous unpaid checkout when ARK/amount changes so a new QR is not bound to it. */
export function mixedQrisCheckoutIdForAmount(input: {
  checkoutId?: string | null;
  boundAmount?: number | null;
  currentAmount: number;
}): string | undefined {
  if (
    input.checkoutId &&
    input.boundAmount != null &&
    input.boundAmount === input.currentAmount
  ) {
    return input.checkoutId;
  }
  return undefined;
}

/**
 * Whether the QRIS prepare effect may return early.
 * `qrisLoading` is ignored: a stuck true after amount change must still prepare.
 */
export function shouldSkipQrisPrepare(input: {
  qrisLoading: boolean;
  existingQrAmount?: number | null;
  currentAmount: number;
  mixedCheckoutId?: string | null;
  isMixedCart: boolean;
  existingQrPaid?: boolean;
}): boolean {
  void input.qrisLoading;
  if (input.existingQrPaid) return false;
  if (input.existingQrAmount !== input.currentAmount) return false;
  if (!input.isMixedCart) return true;
  return Boolean(
    mixedQrisCheckoutIdForAmount({
      checkoutId: input.mixedCheckoutId,
      boundAmount: input.existingQrAmount,
      currentAmount: input.currentAmount,
    })
  );
}

export function mapPaidSaleToReceiptIds(data: {
  checkout_id?: string;
  checkout_number?: string;
  queue_number?: string | null;
  order_ids?: string[];
  order_id?: string;
  id?: string;
  order_number?: string;
}): {
  orderId?: string;
  orderNumber?: string;
  checkoutNumber?: string;
  queueNumber?: string | null;
} {
  if (data.checkout_number) {
    return {
      orderId: data.checkout_id || data.order_ids?.[0],
      orderNumber: data.checkout_number,
      checkoutNumber: data.checkout_number,
      queueNumber: data.queue_number ?? null,
    };
  }
  return {
    orderId: data.order_id || data.id,
    orderNumber: data.order_number,
    queueNumber: data.queue_number ?? null,
  };
}

export function canAddItemToSingleStallCart(
  existingStallIds: string[],
  incomingWarehouseId: string | null | undefined,
  options?: { centralAllMode?: boolean }
): { ok: true } | { ok: false; message: string } {
  if (!incomingWarehouseId) {
    if (options?.centralAllMode) {
      return {
        ok: false,
        message: "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang",
      };
    }
    return { ok: true };
  }
  const existing = uniqueStallIds(existingStallIds);
  if (existing.length === 0 || existing[0] === incomingWarehouseId) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      "Keranjang hanya boleh dari satu stall. Kosongkan keranjang atau ganti filter stall",
  };
}

export function shouldConfirmClearCart(raw: string | null | undefined): boolean {
  return posCartHasItems(raw);
}

/** Phase 1: one stall in the cart + kasir pusat mode all → sell as that stall. */
export function resolveSingleStallSellFromAllMode(input: {
  itemWarehouses: Array<string | null | undefined>;
  canSellMixed: boolean;
}): string | null {
  const stallIds = uniqueStallIds(input.itemWarehouses);
  if (stallIds.length === 1 && input.canSellMixed) {
    return stallIds[0] ?? null;
  }
  return null;
}

/** After resolving stallIds[0] in all-mode, require it is in the user's allowed set. */
export function assertAllModeSellStallAssigned(
  warehouseId: string,
  allowedStallIds: readonly string[]
): { ok: true } | { ok: false; message: string } {
  if (allowedStallIds.includes(warehouseId)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: "Stall aktif di luar penempatan Anda",
  };
}

export type CheckoutChargeSlice = {
  warehouseId: string;
  subtotal: number;
};

export type AllocatedCheckoutSlice = CheckoutChargeSlice & {
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
  total: number;
};

function allocateAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => Math.floor((total * w) / sum));
  const remainder = total - raw.reduce((a, b) => a + b, 0);
  const largest = weights.indexOf(Math.max(...weights));
  if (remainder !== 0 && largest >= 0) raw[largest] += remainder;
  return raw;
}

export function allocateCheckoutCharges(input: {
  slices: CheckoutChargeSlice[];
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
}): AllocatedCheckoutSlice[] {
  const weights = input.slices.map((s) => s.subtotal);
  const discounts = allocateAmount(input.discount, weights);
  const taxes = allocateAmount(input.tax, weights);
  const services = allocateAmount(input.serviceCharge, weights);
  const others = allocateAmount(input.otherCharges, weights);
  return input.slices.map((slice, index) => {
    const discount = discounts[index] ?? 0;
    const tax = taxes[index] ?? 0;
    const serviceCharge = services[index] ?? 0;
    const otherCharges = others[index] ?? 0;
    return {
      ...slice,
      discount,
      tax,
      serviceCharge,
      otherCharges,
      total: slice.subtotal - discount + tax + serviceCharge + otherCharges,
    };
  });
}
