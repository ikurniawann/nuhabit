/** Klien API admin Gym: paket kredit, kredit member, aturan gym. */
import type { GymRules } from "@/lib/gym/rules";
import { call, send } from "../shared";

export type { GymRules };

/** credits: a batch of class credits; pass: unlimited bookings for validity_days. */
export type PackageKind = "credits" | "pass";

export interface BranchPrice {
  branch_id: string;
  price_idr: number;
}

export interface CreditPackage {
  id: string;
  name: string;
  description: string;
  kind: PackageKind;
  credits: number;
  price_idr: number;
  validity_days: number;
  purchase_limit_per_member: number | null;
  applicable_class_type_ids: string[] | null;
  branch_id: string | null;
  branch_name: string | null;
  is_public: boolean;
  badge: string | null;
  /** Pass: juga berlaku untuk sesi personal training. */
  covers_personal: boolean;
  branch_prices: BranchPrice[];
  status: "active" | "archived";
  sort_order: number;
  sold_count: number;
  referenced: boolean;
}

export interface ClassTypeOption {
  id: string;
  name: string;
}

export interface BranchOption {
  id: string;
  name: string;
}

export type PackageInput = Omit<CreditPackage, "id" | "branch_name" | "status" | "sold_count" | "referenced"> & { id?: string };

export type RenewWith = "ark" | "invoice" | "saved_method";

export interface MemberPass {
  id: string;
  package_id: string;
  package_name: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "frozen" | "expired" | "refunded";
  /** Active but queued: starts when the pass before it ends. */
  upcoming: boolean;
  days_left: number;
  frozen_at: string | null;
  frozen_until: string | null;
  auto_renew: boolean;
  renew_with: RenewWith;
  purchase_id: string | null;
}

/** Freeze budget over the last 365 days. */
export interface FreezeAllowance {
  max_days_per_year: number;
  min_days: number;
  used_days: number;
  remaining_days: number;
}

export interface RefundQuote {
  purchase_id: string;
  kind: PackageKind;
  credits: number;
  payment_method: PaymentMethod | null;
  full_idr: number;
  prorated_idr: number;
  total_days: number;
  unused_days: number;
  unused_credits: number;
}

export type RefundMode = "prorated" | "full";

export interface MemberHit {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  is_active: boolean;
  balance: number;
}

export interface CreditLot {
  id: string;
  package_id: string | null;
  package_name: string | null;
  credits: number;
  remaining: number;
  expires_at: string;
  created_at: string;
  expired: boolean;
}

export type EntryType =
  | "top_up"
  | "class_deduction"
  | "refund"
  | "bonus"
  | "expiration"
  | "adjustment"
  | "reversal"
  | "transfer_in"
  | "transfer_out";

/** Transfer entries move credits between members; they are not reversed one by one. */
export const isReversible = (e: CreditEntry) =>
  !e.reversed && !["reversal", "expiration", "transfer_in", "transfer_out"].includes(e.type);

/** Sending credits: whether members may, the monthly cap (0 = none) and what was sent this month. */
export interface TransferAllowance {
  member_enabled: boolean;
  monthly_cap: number;
  sent_this_month: number;
}

export interface TransferResult {
  transferId: string;
  credits: number;
  replayed: boolean;
}

export interface VoucherQuote {
  code: string;
  label: string;
  price_idr: number;
  discount_idr: number;
  total_idr: number;
}

export interface CreditEntry {
  id: string;
  type: EntryType;
  amount: number;
  lot_id: string | null;
  source_type: string | null;
  reverses_entry_id: string | null;
  reversed: boolean;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export type PaymentMethod = "cash" | "card" | "transfer" | "qris" | "ark_coin" | "complimentary";

/** Metode yang dibayar lewat kasir dan masuk shift kasir POS. */
export const TILL_METHODS: readonly PaymentMethod[] = ["cash", "card", "transfer", "qris"];

export interface CreditPurchase {
  id: string;
  package_name: string;
  kind: PackageKind;
  credits: number;
  validity_days: number;
  total_idr: number;
  discount_idr: number;
  channel: "member_portal" | "front_desk";
  payment_method: PaymentMethod | null;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  note: string | null;
  paid_at: string | null;
  refunded_idr: number | null;
  created_at: string;
  branch_id: string | null;
  /** GYM-YYYYMMDD-NNNN; null until paid. */
  receipt_number: string | null;
  pos_shift_id: string | null;
  shift_number: string | null;
}

/** Struk pembelian (cetak ulang memakai data ini). */
export interface PurchaseReceipt {
  receipt_number: string;
  purchase_id: string;
  package_name: string;
  kind: PackageKind;
  credits: number;
  validity_days: number;
  price_idr: number;
  discount_idr: number;
  total_idr: number;
  payment_method: PaymentMethod | null;
  status: CreditPurchase["status"];
  paid_at: string | null;
  refunded_at: string | null;
  refunded_idr: number | null;
  member_name: string | null;
  member_phone: string | null;
  branch_name: string | null;
  cashier_name: string | null;
  shift_number: string | null;
  header_lines: string[];
  footer_lines: string[];
}

/** Penjualan gym dalam satu shift kasir. */
export interface GymShiftSales {
  cash: number;
  qris: number;
  card: number;
  transfer: number;
  sales: number;
  count: number;
  refunds: number;
  cash_refunds: number;
  refund_count: number;
}

/** Ringkasan shift berjalan atau saat ditutup (angka dari POS). */
export interface DeskShiftSummary {
  total_orders: number;
  total_sales: number;
  total_refunds: number;
  opening_cash: number;
  expected_cash: number;
  closing_cash?: number;
  variance?: number;
  gym_sales: GymShiftSales;
}

/** Shift kasir milik staf yang sedang login (pos.pos_shifts). */
export interface DeskShift {
  id: string;
  shift_number: string;
  cashier_id: string;
  branch_id: string | null;
  opened_at: string;
  opening_cash: number;
  summary: DeskShiftSummary;
}

export interface MemberCredits {
  member: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    is_active: boolean;
    membership_tier: string | null;
    ark_balance_idr: number;
  };
  balance: number;
  expiring_credits: number;
  expiry_reminder_days: number;
  low_balance: boolean;
  low_balance_threshold: number;
  lots: CreditLot[];
  passes: MemberPass[];
  freeze: FreezeAllowance;
  transfer: TransferAllowance;
  entries: CreditEntry[];
  purchases: CreditPurchase[];
}

export interface RulesAdmin {
  defaults: GymRules;
  global: GymRules;
  branches: { id: string; name: string; override: Partial<GymRules> }[];
}

export const gymCreditsApi = {
  packages: () =>
    call<{ packages: CreditPackage[]; class_types: ClassTypeOption[]; branches: BranchOption[] }>("/api/gym/packages"),
  savePackage: (input: PackageInput) => send<{ id: string }>("/api/gym/packages", input),
  setPackageStatus: (id: string, status: CreditPackage["status"]) => send(`/api/gym/packages/${id}`, { status }, "PATCH"),
  deletePackage: (id: string) => call(`/api/gym/packages/${id}`, { method: "DELETE" }),

  searchMembers: (q: string) => call<MemberHit[]>(`/api/gym/credits?q=${encodeURIComponent(q)}`),
  memberCredits: (customerId: string) => call<MemberCredits>(`/api/gym/credits/${customerId}`),
  adjust: (customerId: string, amount: number, reason: string) =>
    send<{ balanceAfter: number }>(`/api/gym/credits/${customerId}/adjust`, { amount, reason }),
  sell: (
    customerId: string,
    input: {
      package_id: string;
      payment_method: PaymentMethod;
      discount_idr: number;
      note: string;
      branch_id: string | null;
      voucher_code: string | null;
    }
  ) => send<CreditPurchase>(`/api/gym/credits/${customerId}/sell`, input),
  previewVoucher: (customerId: string, input: { package_id: string; code: string; branch_id: string | null }) =>
    send<VoucherQuote>(`/api/gym/credits/${customerId}/vouchers/preview`, input),
  transfer: (
    customerId: string,
    input: { to_customer_id: string; lots: { lot_id: string; credits: number }[]; note: string; idempotency_key: string }
  ) => send<TransferResult>(`/api/gym/credits/${customerId}/transfer`, input),
  reverse: (entryId: string, reason: string) => send("/api/gym/credits/reverse", { entry_id: entryId, reason }),
  refundQuote: (purchaseId: string) => call<RefundQuote>(`/api/gym/credits/purchases/${purchaseId}/refund-quote`),
  refundPurchase: (purchaseId: string, reason: string, mode: RefundMode) =>
    send<CreditPurchase>(`/api/gym/credits/purchases/${purchaseId}/refund`, { reason, mode }),

  freezePass: (passId: string, days: number) => send<MemberPass>(`/api/gym/passes/${passId}/freeze`, { days }),
  unfreezePass: (passId: string) => send<MemberPass>(`/api/gym/passes/${passId}/unfreeze`, {}),
  extendPass: (passId: string, days: number, reason: string) =>
    send<MemberPass>(`/api/gym/passes/${passId}/extend`, { days, reason }),
  setAutoRenew: (passId: string, autoRenew: boolean, renewWith?: RenewWith) =>
    send<MemberPass>(`/api/gym/passes/${passId}/auto-renew`, { auto_renew: autoRenew, renew_with: renewWith }, "PUT"),

  receipt: (purchaseId: string) => call<PurchaseReceipt>(`/api/gym/credits/purchases/${purchaseId}/receipt`),

  /* Shift kasir front desk; null = belum ada shift terbuka untuk cabang ini. */
  myShift: (branchId: string | null) =>
    call<DeskShift | null>(`/api/pos/shifts/mine${branchQuery(branchId)}`).then((shift) =>
      // Kolom numeric PostgreSQL datang sebagai teks.
      shift ? { ...shift, opening_cash: Number(shift.opening_cash), summary: { ...shift.summary, opening_cash: Number(shift.summary.opening_cash) } } : null
    ),
  openShift: (branchId: string | null, openingCash: number, notes?: string) =>
    send<unknown>(`/api/pos/shifts/mine${branchQuery(branchId)}`, { opening_cash: openingCash, notes }),
  closeShift: (branchId: string | null, closingCash: number, notes?: string) =>
    closeDeskShift(`/api/pos/shifts/mine/close${branchQuery(branchId)}`, { closing_cash: closingCash, notes }),

  rules: () => call<RulesAdmin>("/api/gym/rules"),
  saveRules: (branchId: string | null, rules: Partial<GymRules>) =>
    send<RulesAdmin>("/api/gym/rules", { branch_id: branchId, rules }, "PUT"),
};

const branchQuery = (branchId: string | null) => (branchId ? `?branch_id=${encodeURIComponent(branchId)}` : "");

/** Tutup shift: ringkasan ada di `summary`, di luar `data`. */
async function closeDeskShift(url: string, body: unknown): Promise<DeskShiftSummary> {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Gagal menutup shift");
  return { ...json.summary, opening_cash: Number(json.summary.opening_cash) } as DeskShiftSummary;
}

/* ── Label & format ──────────────────────────────────────────────────── */

export const ENTRY_LABELS: Record<EntryType, string> = {
  top_up: "Beli paket",
  class_deduction: "Booking kelas",
  refund: "Refund kelas",
  bonus: "Bonus",
  expiration: "Kedaluwarsa",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
  transfer_in: "Terima transfer",
  transfer_out: "Kirim transfer",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Tunai",
  card: "Kartu",
  transfer: "Transfer",
  qris: "QRIS",
  ark_coin: "ARK Coin",
  complimentary: "Komplimen",
};

export const KIND_LABELS: Record<PackageKind, string> = {
  credits: "Paket kredit",
  pass: "Pass",
};
