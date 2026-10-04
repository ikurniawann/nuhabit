import { normalizeStation } from '@/lib/pos/kitchen-station';
import type { DiscountType, LineDiscountResult } from '@/lib/pos/manual-discount';
import { resolvePaymentCatalogStamp } from '@/lib/pos/payment-methods';
import { buildCostSnapshot, type loadPosProductCostMap } from '@/lib/pos/purchasing-sync';
import { sanitizeXenditRef } from '@/lib/pos/xendit-ids';

export type PosOrderItemRequest = {
  product_id?: string;
  /** EPIC-039 Fase B — varian merchandise ber-stok; wajib utk produk ber-SKU */
  sku_id?: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number | string;
  unit_price?: number | string;
  variant_price_adjustment?: number | string;
  modifier_price_adjustment?: number | string;
  variants?: unknown[];
  modifiers?: unknown[];
  station?: string;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_amount?: number | string;
};

type ProductCostMap = Awaited<ReturnType<typeof loadPosProductCostMap>>;

/** Qty kosong/0/aneh → 1. */
export function itemQuantity(item: PosOrderItemRequest) {
  return Number(item.quantity) || 1;
}

/** Harga satuan efektif = harga dasar + penyesuaian varian + modifier. */
export function itemUnitPrice(item: PosOrderItemRequest) {
  return (
    (Number(item.unit_price) || 0) +
    (Number(item.variant_price_adjustment) || 0) +
    (Number(item.modifier_price_adjustment) || 0)
  );
}

export function itemLineSubtotal(item: PosOrderItemRequest) {
  return itemUnitPrice(item) * itemQuantity(item);
}

export function computeItemsSubtotal(items: PosOrderItemRequest[]) {
  return items.reduce((sum, item) => sum + itemLineSubtotal(item), 0);
}

export function parseDiscountType(raw: unknown): DiscountType | null {
  return raw === 'percent' || raw === 'fixed' ? raw : null;
}

/** null/'' → null (tidak ada nilai), selain itu Number(). */
export function parseNullableNumber(raw: number | string | null | undefined) {
  return raw == null || raw === '' ? null : Number(raw);
}

export function buildLineInputs(items: PosOrderItemRequest[]) {
  return items.map((item) => ({
    line_subtotal: itemLineSubtotal(item),
    discount_type: parseDiscountType(item.discount_type),
    discount_value: parseNullableNumber(item.discount_value),
  }));
}

/**
 * Total yang dipercaya server. NFC Tab, gift card, dan order ber-promo WAJIB
 * turunan server (nominal ledger tab / debit saldo titipan / promo tak boleh
 * dari klien). Selain itu total klien dipakai, jatuh ke turunan server bila
 * kosong/0.
 */
export function resolveTrustedTotal(input: {
  paymentMethod: string;
  hasPromoHold: boolean;
  clientTotal: number | string | undefined;
  subtotal: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
}) {
  const serverDerived =
    input.subtotal - input.discount + input.tax + input.serviceCharge + input.otherCharges;
  const mustDerive =
    input.paymentMethod === 'nfc_tab' || input.paymentMethod === 'gift_card' || input.hasPromoHold;
  return mustDerive ? serverDerived : Number(input.clientTotal) || serverDerived;
}

export function computeChangeAmount(paidAmount: number, arkUsed: number, total: number) {
  return Math.max(0, paidAmount + arkUsed - total);
}

export type OrderInsertInput = {
  presetOrderId: string | null;
  promoOrderId: string | null;
  orderNumber: string;
  queueNumber: unknown;
  orderType: string;
  deferPaid: boolean;
  companyId: string | null;
  branchId: string | null;
  warehouseId: string;
  customerId: string | null;
  cashierId: string;
  serverId: string | null;
  tableId: string | null;
  guestCount: number;
  shiftId: string | null;
  subtotal: number;
  discount: number;
  discountReason: string | null;
  manualDiscountType: DiscountType | null;
  manualDiscountValue: number | null;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
  chargesBreakdown: unknown[];
  total: number;
  paidAmount: number;
  arkUsed: number;
  paymentMethod: string;
  notes: string | null;
  specialRequests: string | null;
  orderedAt: string;
  soldFrom: string;
  xenditQrId: string | undefined;
  xenditExternalId: string | undefined;
  paymentMethodCode: string | undefined;
  paymentMethodName: string | undefined;
  compType: string | null;
  focApprover: { id: string; name: string } | null;
};

/**
 * Payload insert pos_orders. `legacy` = fallback utk DB lama yang belum punya
 * kolom baru (42703/PGRST204): tanpa kolom manual discount, sold_from, xendit,
 * katalog metode bayar, comp, dan memakai id promo (bukan id preset offer).
 */
export function buildOrderInsertRows(input: OrderInsertInput) {
  const core = {
    order_number: input.orderNumber,
    queue_number: input.queueNumber,
    order_type: input.orderType,
    status: 'pending',
    payment_status: input.deferPaid ? 'unpaid' : 'paid',
    company_id: input.companyId,
    branch_id: input.branchId,
    warehouse_id: input.warehouseId,
    customer_id: input.customerId,
    cashier_id: input.cashierId,
    server_id: input.serverId,
    table_id: input.tableId,
    guest_count: input.guestCount,
    shift_id: input.shiftId,
    subtotal: input.subtotal,
    discount_amount: input.discount,
    discount_reason: input.discountReason,
    tax_amount: input.tax,
    service_charge_amount: input.serviceCharge,
    other_charges_amount: input.otherCharges,
    charges_breakdown: input.chargesBreakdown,
    total_amount: input.total,
    amount_paid: input.paidAmount,
    change_amount: computeChangeAmount(input.paidAmount, input.arkUsed, input.total),
    payment_method: input.paymentMethod,
    ark_coins_used: input.arkUsed,
    notes: input.notes,
    special_requests: input.specialRequests,
    ordered_at: input.orderedAt,
  };
  const row = {
    ...(input.presetOrderId ? { id: input.presetOrderId } : {}),
    ...core,
    manual_discount_type: input.manualDiscountType,
    manual_discount_value: input.manualDiscountValue,
    sold_from: input.soldFrom,
    xendit_qr_id: sanitizeXenditRef(input.xenditQrId),
    xendit_external_id: sanitizeXenditRef(input.xenditExternalId),
    ...resolvePaymentCatalogStamp({
      code: input.paymentMethodCode,
      name: input.paymentMethodName,
    }),
    ...(input.compType ? { comp_type: input.compType } : {}),
    // FOC = komplimen: pendapatan diakui 0 — diskon 100% dari gross,
    // pajak/service digugurkan (tidak ada pembayaran), penyetuju dicatat.
    ...(input.focApprover
      ? {
          discount_amount: input.subtotal,
          discount_reason: 'FOC',
          tax_amount: 0,
          service_charge_amount: 0,
          other_charges_amount: 0,
          total_amount: 0,
          amount_paid: 0,
          change_amount: 0,
          comp_type: 'foc_comp',
          comp_approved_by: input.focApprover.id,
          comp_approved_name: input.focApprover.name,
        }
      : {}),
  };
  const legacy = {
    ...(input.promoOrderId ? { id: input.promoOrderId } : {}),
    ...core,
  };
  return { row, legacy };
}

export type OrderItemRow = ReturnType<typeof buildOrderItemRows>[number];

export function buildOrderItemRows(input: {
  orderId: string;
  items: PosOrderItemRequest[];
  lineResults: LineDiscountResult[];
  costMap: ProductCostMap;
  skuByProduct: Map<string, string | null | undefined>;
  merchClaimedIds: Set<string>;
}) {
  return input.items.map((item, index) => {
    const qty = itemQuantity(item);
    const unitPrice = itemUnitPrice(item);
    const subtotalValue = unitPrice * qty;
    const line = input.lineResults[index];
    const lineTotal = line?.total_amount ?? subtotalValue;
    return {
      order_id: input.orderId,
      product_id: item.product_id,
      sku_id: item.sku_id || null,
      product_name: item.product_name || 'Unknown',
      product_sku: String(
        input.skuByProduct.get(String(item.product_id)) || item.product_sku || item.product_id || ''
      ).slice(0, 50),
      variants: item.variants || [],
      modifiers: item.modifiers || [],
      quantity: qty,
      unit_price: unitPrice,
      subtotal: subtotalValue,
      discount_type: parseDiscountType(item.discount_type),
      discount_value: parseNullableNumber(item.discount_value),
      discount_amount: line?.discount_amount ?? 0,
      total_amount: lineTotal,
      xp_earned: 0,
      station: normalizeStation(item.station, String(item.product_name || ''), ''),
      kitchen_status: 'pending',
      // EPIC-039 Fase A — true untuk baris merchandise yang stoknya sudah
      // diklaim; dipakai restore saat order dibatalkan.
      inventory_deducted: item.product_id
        ? input.merchClaimedIds.has(String(item.product_id))
        : false,
      ...buildCostSnapshot(
        item.product_id ? input.costMap.get(item.product_id) : undefined,
        qty,
        lineTotal
      ),
    };
  });
}

/** DB lama tanpa kolom stasiun/SKU/HPP/diskon per baris. */
const LEGACY_DROPPED_ITEM_COLUMNS = [
  'station',
  'kitchen_status',
  'sku_id',
  'cost_price',
  'cost_total',
  'gross_profit',
  'gross_margin_pct',
  'discount_type',
  'discount_value',
] as const;

export function stripLegacyItemColumns(rows: OrderItemRow[]) {
  return rows.map((row) => {
    const legacy: Partial<OrderItemRow> = { ...row };
    for (const column of LEGACY_DROPPED_ITEM_COLUMNS) delete legacy[column];
    return legacy;
  });
}
