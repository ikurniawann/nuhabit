export type PaymentMethod = "qris" | "cash" | "foc";
export type TopupStatus =
  | "idle"
  | "enter_amount"
  | "payment"
  | "processing"
  | "awaiting_qris"
  | "success";

export interface TopupCustomer {
  id: string;
  name?: string | null;
  phone: string;
  email?: string | null;
  membership_tier?: string | null;
  ark_coin_balance: number;
  nfc_uid?: string | null;
}

export interface TopupResult {
  status?: "pending" | "completed" | string;
  transaction?: {
    id: string;
    payment_method?: string;
    created_at?: string;
    status?: string;
  };
  topup_id?: string;
  balance_before: number;
  balance_after: number;
  ark_coins: number;
  ark_rate?: number;
  xp_awarded?: number;
  qr_code_url?: string | null;
  qr_string?: string | null;
  xendit_qr_id?: string;
  reference_id?: string;
  expires_at?: string | null;
}

export interface CustomerListParams {
  search?: string;
}

export interface ProcessTopupPayload {
  customer_id: string;
  amount: number;
  payment_method: string;
  /** Wajib bila payment_method = 'foc' (topup gratis, butuh persetujuan supervisor). */
  supervisor_pin?: string;
  /** Paket top-up (harga & bonus dari paket; amount diabaikan server). */
  package_id?: string;
}

export type TopupHistoryStatus = "pending" | "completed" | "expired" | "failed" | "cancelled" | string;

export type WalletTxnType =
  | "topup"
  | "topup_bonus"
  | "payment"
  | "refund"
  | "bonus"
  | "redeem"
  | string;

export interface TopupHistoryItem {
  id: string;
  customer_id?: string;
  /** Jenis mutasi wallet — topup/payment/refund/bonus/… */
  type?: WalletTxnType | null;
  amount: number;
  ark_coins?: number;
  balance_before?: number;
  balance_after?: number;
  payment_method?: string | null;
  status?: TopupHistoryStatus | null;
  reference_id?: string | null;
  notes?: string | null;
  order_id?: string | null;
  /** Diisi API dari join pos_orders bila order_id ada. */
  order_number?: string | null;
  created_at?: string | null;
  metadata?: {
    qr_string?: string | null;
    expires_at?: string | null;
    [key: string]: unknown;
  } | null;
  xendit_transaction_id?: string | null;
}
