export type GiftCardStatus =
  | "pending"
  | "active"
  | "disabled"
  | "exhausted"
  | "expired";

export const GIFT_CARD_STATUS_LABELS: Record<GiftCardStatus, string> = {
  pending: "Menunggu Bayar",
  active: "Aktif",
  disabled: "Nonaktif",
  exhausted: "Habis Terpakai",
  expired: "Kedaluwarsa",
};

export interface GiftCard {
  id: string;
  code: string;
  initial_value: string;
  balance: string;
  status: GiftCardStatus;
  expires_at: string | null;
  source_type: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  note: string | null;
  created_at: string;
  reloaded_total: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
}

export interface GiftCardMember {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface GiftCardReloadValues {
  amount: number;
  payment_method: string;
  payment_reference?: string | null;
  note?: string | null;
}

export interface GiftCardIssueSingleValues {
  mode: "single";
  initial_value: number;
  expires_at?: string | null;
  buyer_name?: string | null;
  buyer_phone?: string | null;
  note?: string | null;
  customer_id?: string | null;
}

export interface GiftCardIssueBatchValues {
  mode: "batch";
  initial_value: number;
  count: number;
  expires_at?: string | null;
}

export type GiftCardIssueValues =
  | GiftCardIssueSingleValues
  | GiftCardIssueBatchValues;

/** EPIC-034 Fase B — konfigurasi nominal & masa berlaku (keputusan owner #4). */
export interface GiftCardConfigValues {
  presets: number[];
  allow_custom: boolean;
  /** null = kartu tanpa kedaluwarsa */
  expiry_months: number | null;
}

export interface GiftCardLedgerEntry {
  id: string;
  direction: "isi" | "pakai" | "koreksi";
  amount: string;
  balance_after: string;
  context_type: string | null;
  context_id: string | null;
  note: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}
