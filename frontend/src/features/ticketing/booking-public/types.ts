import type { CatalogProduct } from "@/lib/ticketing/booking-wizard-cart";

export interface BookingCatalog {
  venueName: string;
  products: CatalogProduct[];
}

/** EPIC-031 D: slot jam kunjungan (venue tanpa timed-entry = daftar kosong). */
export interface TimeSlot {
  slot_id: string;
  label: string;
  start_time: string;
  end_time: string;
  status: "available" | "sold_out";
}

/** EPIC-032 B2: hasil /promo-check (indikatif; final di server saat create). */
export type PromoCheckResult =
  | { ok: true; discount: number; campaign_name: string }
  | { ok: false; message?: string };

export interface PromoCheckInput {
  code: string;
  subtotal: number;
  phone?: string;
}

/** Hasil create booking / pass: arahkan pengunjung ke invoice atau status. */
export interface CheckoutRedirect {
  invoice_url: string | null;
  status_url: string;
}

export interface BookingStatusItem {
  product_name: string;
  variant_name: string;
  qty: number;
  unit_price: number;
  season_kind: string;
  subtotal: number;
}

export interface BookingStatusData {
  booking_code: string;
  visit_date: string;
  customer_name: string;
  status: string;
  total: number;
  /** EPIC-032 B2: potongan promo (0 = tanpa promo) & jumlah dibayar. */
  discount_amount: number;
  promo_code: string | null;
  payable: number;
  /** EPIC-032 D2: hadiah, nama penerima (null = bukan hadiah). */
  gift_recipient_name: string | null;
  /** EPIC-031 D: jam slot (null = sepanjang hari). */
  slot_label: string | null;
  slot_start_time: string | null;
  slot_end_time: string | null;
  invoice_url: string | null;
  expires_at: string | null;
  paid_at: string | null;
  used_at: string | null;
  items: BookingStatusItem[];
  guests: { guest_name: string; variant_name: string }[];
}

export interface PassProduct {
  ticket_product_id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  validity_months: number;
  entry_policy: string;
  visit_quota: number | null;
  unit_price: number;
}

export interface PassCatalog {
  venueName: string;
  passes: PassProduct[];
}

export interface PassPurchaseInput {
  ticket_product_id: string;
  holder_name: string;
  holder_phone: string;
}

export interface PassStatus {
  pass_code: string;
  holder_name: string;
  product_name: string;
  status: string;
  entry_policy: string;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  unit_price: number;
  qr_value: string;
  invoice_url: string | null;
}

/** Label kebijakan masuk untuk pengunjung publik. */
export const PUBLIC_ENTRY_LABEL: Record<string, string> = {
  once_per_day: "1× per hari",
  unlimited: "Masuk tak terbatas",
  limited_visits: "Jatah kunjungan",
};
