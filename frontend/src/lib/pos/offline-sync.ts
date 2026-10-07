/**
 * Helper murni untuk mode offline POS: klasifikasi kegagalan sinkron,
 * keputusan auto-sync, dan penyusunan payload order offline.
 * Tanpa React / IndexedDB supaya mudah diuji.
 */

import type { PosCartItem } from "@/hooks/use-pos-cart";
import type { CreateOrderRequest, OrderItem } from "@/lib/pos-api";
import type { BillChargesResult } from "@/lib/pos/billing-settings";

/** Jeda antar percobaan auto-sync saat masih ada antrian. */
export const AUTO_SYNC_INTERVAL_MS = 45_000;
/** Tunggu sebentar setelah event `online` — koneksi sering belum stabil. */
export const AUTO_SYNC_ONLINE_DELAY_MS = 1_500;

export type SyncFailureKind = "retry" | "failed";

/**
 * Gagal karena jaringan / server tumbang → `retry` (item tetap pending,
 * dicoba lagi otomatis). Ditolak server dengan alasan bisnis (validasi,
 * stok, kuota) → `failed` (butuh keputusan kasir: coba lagi atau buang).
 *
 * fetchAPI melempar Error(data.error) untuk respons non-2xx; respons 5xx
 * tanpa JSON melempar SyntaxError dari response.json().
 */
export function classifySyncFailure(thrown: unknown): SyncFailureKind {
  if (thrown instanceof TypeError || thrown instanceof SyntaxError) return "retry";
  const message = thrown instanceof Error ? thrown.message : String(thrown ?? "");
  if (/^API error: 5\d\d/.test(message)) return "retry";
  if (/failed to fetch|networkerror|network error|load failed|timeout|offline/i.test(message)) {
    return "retry";
  }
  return "failed";
}

export function shouldAutoSync(input: { online: boolean; pendingCount: number; syncing: boolean }): boolean {
  return input.online && input.pendingCount > 0 && !input.syncing;
}

export function offlineReceiptNumber(now: number): string {
  return `OFFLINE-${now.toString(36).toUpperCase()}`;
}

export function isOfflineReceiptNumber(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("OFFLINE-");
}

/** Metode bayar yang butuh validasi server saat itu juga — tidak bisa offline. */
export const OFFLINE_UNSUPPORTED_METHODS = new Set(["ark_coin", "nfc_tab", "gift_card", "foc"]);

export function canPayOffline(method: string): boolean {
  return !OFFLINE_UNSUPPORTED_METHODS.has(method);
}

const PAYMENT_METHOD_MAP: Record<string, NonNullable<CreateOrderRequest["payment_method"]>> = {
  cash: "cash",
  qris: "qris",
  credit_card: "credit",
  credit: "credit",
  debit: "debit",
};

export interface OfflineOrderInput {
  items: PosCartItem[];
  orderType: CreateOrderRequest["order_type"];
  cashierId: string;
  customerId?: string | null;
  method: string;
  cashReceived: string;
  /** Hasil cart.buildDiscountStack — dipakai apa adanya supaya angka struk = angka server. */
  discountStack: {
    gross_subtotal: number;
    discount_amount: number;
    line_results: Array<{ discount_amount: number; total_amount: number }>;
  };
  billCharges: BillChargesResult;
  includeTax: boolean;
  membershipDiscountPct: number;
  manualDiscountType: "percent" | "fixed" | null;
  manualDiscountValue: number | null;
  notes: string;
  shiftId?: string | null;
  paymentMethodCode?: string;
  paymentMethodName?: string;
}

/**
 * Payload createOrder untuk antrian offline. Pemetaan item identik dengan
 * use-pos-checkout (harga dasar + penyesuaian varian/modifier terpisah)
 * sehingga saat sinkron server menghitung ulang ke angka yang sama.
 */
export function buildOfflineOrderPayload(input: OfflineOrderInput): CreateOrderRequest {
  const items: OrderItem[] = input.items.map((item, index) => {
    const line = input.discountStack.line_results[index];
    const lineGross = item.price * item.quantity;
    return {
      product_id: item.productId,
      sku_id: item.skuId,
      product_name: item.name,
      product_sku: item.skuCode || `SKU-${item.productId}`,
      variants: item.variantName
        ? [{ name: item.variantName, group: "Size", price: item.variantPriceAdj || 0 }]
        : [],
      modifiers: item.modifierNames?.map((name, idx) => ({ name, group: `Option-${idx}` })) || [],
      station: item.station,
      quantity: Number(item.quantity),
      unit_price: Number(item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)),
      variant_price_adjustment: item.variantPriceAdj || 0,
      modifier_price_adjustment: item.modifierPriceAdj || 0,
      subtotal: lineGross,
      discount_type: item.discount_type ?? null,
      discount_value: item.discount_value ?? null,
      discount_amount: line?.discount_amount ?? 0,
      total_amount: line?.total_amount ?? lineGross,
    };
  });

  const total = input.billCharges.total;
  const cash = Number.parseFloat(input.cashReceived);
  const paymentMethod = PAYMENT_METHOD_MAP[input.method] ?? "cash";

  return {
    order_type: input.orderType,
    customer_id: input.customerId ?? undefined,
    cashier_id: input.cashierId,
    items,
    subtotal: input.discountStack.gross_subtotal,
    discount_amount: input.discountStack.discount_amount,
    manual_discount_type: input.manualDiscountType,
    manual_discount_value: input.manualDiscountValue,
    tax_amount: input.billCharges.tax_amount,
    service_charge_amount: input.billCharges.service_charge_amount,
    other_charges_amount: input.billCharges.other_charges_amount,
    charges_breakdown: input.billCharges.breakdown,
    total_amount: total,
    payment_method: paymentMethod,
    amount_paid: paymentMethod === "cash" && Number.isFinite(cash) && cash > 0 ? cash : total,
    payment_method_code: input.paymentMethodCode,
    payment_method_name: input.paymentMethodName,
    include_tax: input.includeTax,
    membership_discount_pct: input.membershipDiscountPct,
    notes: input.notes,
    ark_coins_used: 0,
    shift_id: input.shiftId ?? undefined,
  };
}
