// Tipe & pesan bersama checkout gabungan (kasir pusat, multi-stall).
import type { PosProductCostRow } from "@/lib/pos/purchasing-sync";

export const CHECKOUT_CANCELLED_NOTE = "cancelled";
export const CHECKOUT_CANCEL_HAS_CHILDREN_MESSAGE =
  "Checkout dengan pesanan tidak bisa dibatalkan";
export const CHECKOUT_CANCEL_PAID_MESSAGE = "Checkout sudah lunas";

export const MIXED_STALL_FORBIDDEN_MESSAGE =
  "Keranjang campur stall hanya untuk kasir pusat";
export const MISSING_PRODUCT_STALL_MESSAGE =
  "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang";
export const CHECKOUT_QRIS_MISSING_MESSAGE = "QRIS belum dibuat untuk checkout ini";
export const CHECKOUT_QRIS_UNPAID_MESSAGE = "QRIS belum lunas";
export const MULTI_STALL_REQUIRED_MESSAGE =
  "Checkout multi-stall membutuhkan item dari minimal 2 stall";

export class MixedCheckoutError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MixedCheckoutError";
    this.status = status;
  }
}

export type MixedCheckoutGuardResult =
  | { ok: true; createCheckout: boolean; stallIds: string[] }
  | { ok: false; message: string };

export type MixedCheckoutItem = {
  product_id?: string;
  sku_id?: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number | string;
  unit_price?: number | string;
  variant_price_adjustment?: number | string;
  modifier_price_adjustment?: number | string;
  variants?: unknown[];
  modifiers?: unknown[];
  station?: string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_amount?: number | string;
  warehouse_id?: string;
};

export type MixedCheckoutCartSnapshot = {
  items: MixedCheckoutItem[];
  warehouseByProduct: Record<string, string>;
  orderType: string;
  guestCount: number;
  notes: string | null;
  specialRequests: string | null;
  chargesBreakdown: unknown;
  cashierId: string;
  serverId: string | null;
  sessionUserId: string;
  discountReason: string | null;
};

/** Supervisor penyetuju FOC (sudah diverifikasi route). */
export type CompApprover = { id: string; name: string };

export type CreateMixedCheckoutInput = {
  items: MixedCheckoutItem[];
  warehouseByProduct: Map<string, string | null>;
  orderType?: string;
  customerId?: string | null;
  cashierId: string;
  serverId?: string | null;
  tableId?: string | null;
  guestCount?: unknown;
  discountAmount?: number | string;
  discountReason?: string | null;
  promoCode?: string | null;
  taxAmount?: number | string;
  serviceChargeAmount?: number | string;
  otherChargesAmount?: number | string;
  chargesBreakdown?: unknown;
  totalAmount?: number | string;
  paymentMethod?: string;
  paymentStatus?: string | null;
  amountPaid?: number | string;
  arkCoinsUsed?: number | string;
  notes?: string | null;
  specialRequests?: string | null;
  branchId?: string | null;
  shiftId?: string | null;
  companyId?: string | null;
  sessionUserId: string;
  /** Restaurant open-bill: insert unpaid children so KDS/floor can see them. */
  forceInsertChildren?: boolean;
  /** Append mixed items onto the table's existing unpaid central checkout. */
  reuseUnpaidTableCheckout?: boolean;
  /** Continue a specific unpaid checkout (takeaway / no table / explicit). */
  existingCheckoutId?: string | null;
  paymentMethodCode?: string | null;
  paymentMethodName?: string | null;
  /** EPIC-043 — 'kol_comp': seluruh anak-order distempel komplimen KOL. */
  compType?: string | null;
  /** Metode FOC — supervisor penyetuju (tercatat di comp_approved_by/name). */
  compApproved?: CompApprover | null;
};

export type MixedCheckoutResult = {
  checkoutId: string;
  checkoutNumber: string;
  queueNumber: string;
  orderIds: string[];
  /**
   * EPIC-041: snapshot utk struk — saldo ARK sesudah potong (dari RPC, bukan
   * query terpisah), XP transaksi ini, dan total XP member sesudah award.
   * null/undefined bila bukan pembayaran ARK / bukan member.
   */
  arkBalanceAfter?: number | null;
  xpAwarded?: number;
  xpTotalAfter?: number | null;
};

export type BuiltLine = MixedCheckoutItem & {
  warehouseId: string;
  qty: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTotal: number;
};

/** Potongan keranjang per stall (satu stall = satu anak-order). */
export type StallSlice = {
  warehouseId: string;
  subtotal: number;
  lines: BuiltLine[];
};

export type CostMap = Map<string, PosProductCostRow>;

export type CheckoutRow = {
  id: string;
  checkout_number: string;
  queue_number: string | null;
  payment_status: string;
  payment_method: string | null;
  company_id: string | null;
  branch_id: string | null;
  table_id: string | null;
  customer_id: string | null;
  cashier_id: string;
  shift_id: string | null;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  service_charge_amount: string | number;
  other_charges_amount: string | number;
  total_amount: string | number;
  amount_paid: string | number;
  change_amount: string | number;
  ark_coins_used?: string | number | null;
  notes: string | null;
  cart_snapshot?: MixedCheckoutCartSnapshot | null;
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
  payment_method_code?: string | null;
  payment_method_name?: string | null;
};

export type XenditPaidWebhookAction =
  | { type: "credit_topup" }
  | { type: "complete_checkout"; checkoutId: string }
  | { type: "noop_checkout"; checkoutId: string }
  | { type: "complete_order"; orderId: string }
  | { type: "ignore" };

export type CompleteMixedCheckoutTender = {
  paymentMethod?: string | null;
  amountPaid?: number | null;
  paymentMethodCode?: string | null;
  paymentMethodName?: string | null;
  /** Metode FOC — supervisor penyetuju (sudah diverifikasi route). */
  compApproved?: CompApprover | null;
};

export type CompleteMixedCheckoutOptions = {
  /** Webhook already verified paid; skip Xendit GET re-confirm. */
  paymentAlreadyConfirmed?: boolean;
};
