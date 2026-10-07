import type { BookingStatus } from "@/lib/ticketing/booking";

export type { BookingStatus };

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  "menunggu-bayar": "Menunggu Bayar",
  terbayar: "Terbayar",
  digunakan: "Digunakan",
  kedaluwarsa: "Kedaluwarsa",
  dibatalkan: "Dibatalkan",
  hangus: "Hangus",
};

export const BOOKING_STATUS_BADGES: Record<BookingStatus, string> = {
  "menunggu-bayar": "bg-amber-100 text-amber-700",
  terbayar: "bg-emerald-100 text-emerald-700",
  digunakan: "bg-blue-100 text-blue-700",
  kedaluwarsa: "bg-gray-100 text-gray-500",
  dibatalkan: "bg-red-100 text-red-700",
  hangus: "bg-orange-100 text-orange-700",
};

export interface BookingItem {
  product_name: string;
  variant_name: string;
  qty: number;
  unit_price: number;
  season_kind: string;
  subtotal: number;
}

export interface BookingLookupItem extends BookingItem {
  variant_id: string;
  ticket_product_id: string;
}

/** Anggota rombongan — satu baris per unit tiket, posisi 1 = pemesan. */
export interface BookingGuest {
  id: string;
  guest_name: string;
  position: number;
  variant_id: string;
  product_name: string;
  variant_name: string;
}

/** Hasil lookup kode di loket (D4) — bekal dialog redeem. */
export interface BookingLookup {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  /** EPIC-032 D2 — hadiah: nama penerima (null = bukan hadiah). */
  gift_recipient_name: string | null;
  customer_phone: string;
  status: BookingStatus;
  total: number;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  redeemable: boolean;
  today: string;
  items: BookingLookupItem[];
  guests: BookingGuest[];
}

export interface BookingListItem {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: BookingStatus;
  total: number;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  refund_note: string | null;
  /** Anomali webhook Xendit yang butuh tindak lanjut manual (null = aman). */
  webhook_alert: string | null;
  created_at: string;
}

export interface BookingListResponse {
  success: boolean;
  data: BookingListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface BookingFilters {
  date: string;
  status: BookingStatus | "";
  q: string;
  page: number;
}

export interface BookingDetail extends BookingListItem {
  xendit_invoice_url: string | null;
  expires_at: string | null;
  items: BookingItem[];
  guests: { guest_name: string; position: number; variant_name: string }[];
}

/** Pairing satu gelang NFC ke satu anggota rombongan. */
export interface RedeemBand {
  nfc_uid: string;
  guest_id: string;
}

/** EPIC-031 Fase C — okupansi harian (dashboard boleh lihat angka). */
export interface OccupancyDay {
  date: string;
  online: number;
  walk_in: number;
  /** null = unlimited (kuota tidak aktif untuk tanggal ini). */
  capacity: number | null;
}
