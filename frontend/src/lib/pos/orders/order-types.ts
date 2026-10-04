import type { DbClient } from '@/lib/pg/types';
import type { MerchStockClaim } from '@/lib/pos/merchandise-stock';
import type { PosOrderItemRequest } from './order-pricing';

export type PosOrderBody = {
  order_type?: string;
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong/aneh → 1 orang. */
  guest_count?: number | string;
  items?: PosOrderItemRequest[];
  subtotal?: number | string;
  discount_amount?: number | string;
  discount_reason?: string;
  manual_discount_type?: string | null;
  manual_discount_value?: number | string | null;
  /** EPIC-032 C1 — kode promo (server evaluasi & override diskon). */
  promo_code?: string;
  membership_discount_pct?: number | string;
  tax_amount?: number | string;
  service_charge_amount?: number | string;
  other_charges_amount?: number | string;
  charges_breakdown?: unknown;
  total_amount?: number | string;
  payment_method?: string;
  amount_paid?: number | string;
  notes?: string;
  special_requests?: string;
  ark_coins_used?: number | string;
  include_tax?: boolean;
  splits?: unknown[];
  branch_id?: string;
  shift_id?: string;
  /** UID gelang ticketing — wajib saat payment_method 'nfc_tab' (EPIC-023 Fase C) */
  nfc_tab_uid?: string;
  /** Kode gift card — wajib saat payment_method 'gift_card' (EPIC-034 Fase C) */
  gift_card_code?: string;
  /** Data pembeli saat MENJUAL gift card — nomor dipakai kirim kode via WA (Fase B) */
  gift_card_buyer_name?: string;
  gift_card_buyer_phone?: string;
  xendit_qr_id?: string;
  xendit_external_id?: string;
  payment_method_code?: string;
  payment_method_name?: string;
  /** EPIC-043: 'kol_comp' = komplimen KOL (divalidasi server, gratis penuh). */
  comp_type?: string;
  /** PIN supervisor — wajib saat metode bayar FOC (Free of Charge). */
  supervisor_pin?: string;
};

/** Body dgn default yang sama seperti destructuring lama (hanya utk `undefined`). */
export function withOrderDefaults(body: PosOrderBody) {
  const {
    order_type = 'dine_in',
    items = [],
    discount_amount = 0,
    tax_amount = 0,
    service_charge_amount = 0,
    other_charges_amount = 0,
    charges_breakdown = [],
    payment_method = 'cash',
    amount_paid = 0,
    ark_coins_used = 0,
    include_tax = false,
  } = body;
  return {
    ...body,
    order_type,
    items,
    discount_amount,
    tax_amount,
    service_charge_amount,
    other_charges_amount,
    charges_breakdown,
    payment_method,
    amount_paid,
    ark_coins_used,
    include_tax,
  };
}

export type OrderRequest = ReturnType<typeof withOrderDefaults>;

/** Konteks yang sudah lolos validasi stall/privilege di createPosOrder. */
export type OrderContext = {
  db: DbClient;
  req: OrderRequest;
  sessionUserId: string;
  cashierId: string;
  sellWarehouseId: string;
  soldFrom: string;
  /** Nominal gift card yang DIJUAL di order ini (kosong = tidak menjual). */
  giftCardNominals: number[];
};

/** Hasil service; route cukup `NextResponse.json(body, { status })`. */
export type OrderResponse = { status: number; body: Record<string, unknown> };

export function orderError(status: number, error: string | undefined): OrderResponse {
  return { status, body: { success: false, error } };
}

/**
 * EPIC-039 Fase A — klaim stok merchandise yang harus dikembalikan bila order
 * gagal dibuat. Kosong = tidak ada yang perlu dikompensasi. Dibagi antara
 * alur order tunggal dan catch di createPosOrder.
 */
export type MerchClaimsRef = { claims: MerchStockClaim[] };
