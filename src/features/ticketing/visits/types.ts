import type { PaymentMode } from "../masters/types";
import type { GateTapResult } from "@/lib/ticketing/gate-server";

export type VisitStatus = "open" | "settled" | "void";
export type CashMethod = "cash" | "qris" | "card";

export const CASH_METHOD_LABELS: Record<CashMethod, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card: "Kartu / EDC",
};

export interface VisitListItem {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  payment_mode: PaymentMode;
  credit_limit: string | null;
  status: VisitStatus;
  opened_at: string;
  settled_at: string | null;
  band_count: number;
  active_band_count: number;
  debit: number;
  kredit: number;
  outstanding: number;
  saldo: number;
}

export interface VisitListResponse {
  success: boolean;
  data: VisitListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface VisitFilters {
  status: VisitStatus;
  q: string;
  page: number;
}

export interface VisitBand {
  id: string;
  band_id: string;
  nfc_uid: string;
  label: string | null;
  variant_id: string;
  /** "Nama Ticket — Varian" (label gabungan dari server). */
  ticket_type_name: string;
  /** Nama anggota rombongan booking (null utk walk-in). */
  guest_name: string | null;
  entered_at: string | null;
  status: "aktif" | "selesai" | "hilang";
}

export interface VisitCharge {
  id: string;
  band_id: string | null;
  charge_type: string;
  direction: "debit" | "kredit";
  description: string;
  amount: number;
  payment_method: string | null;
  pos_order_id: string | null;
  voided_by_charge_id: string | null;
  created_at: string;
}

export interface VisitDetail {
  visit: {
    id: string;
    contact_name: string;
    contact_phone: string | null;
    payment_mode: PaymentMode;
    credit_limit: number | null;
    status: VisitStatus;
    opened_at: string;
    settled_at: string | null;
    notes: string | null;
  };
  bands: VisitBand[];
  charges: VisitCharge[];
  summary: { debit: number; kredit: number; outstanding: number; saldo: number };
  plan: { amountDue: number; refundAmount: number };
}

export interface RegisterVisitBand {
  nfc_uid: string;
  variant_id: string;
}

/** Fase P — 1 entri = 1 unit paket; band_uids urut anggota komposisi. */
export interface RegisterVisitBundle {
  bundle_variant_id: string;
  band_uids: string[];
}

export interface RegisterVisitValues {
  contact_name: string;
  contact_phone?: string | null;
  payment_mode: PaymentMode;
  credit_limit?: number | null;
  deposit?: { amount: number; method: CashMethod } | null;
  bands: RegisterVisitBand[];
  bundles?: RegisterVisitBundle[];
}

export interface SettleValues {
  visit_band_id?: string | null;
  payments?: { method: CashMethod; amount: number }[];
  refund_method?: CashMethod;
}

export interface GateTapResponse {
  // union dari route gate/tap — typo hasil tap ketahuan compiler
  result: GateTapResult | "error";
  ok: boolean;
  reason?: string;
  contact_name?: string;
  ticket_type_name?: string;
  /** Nama anggota rombongan booking (null/absen utk walk-in). */
  guest_name?: string | null;
  band_label?: string | null;
  charged_amount?: number;
}
