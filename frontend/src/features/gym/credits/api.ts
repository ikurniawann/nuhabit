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

export interface MemberPass {
  id: string;
  package_id: string;
  package_name: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "expired" | "refunded";
  days_left: number;
  purchase_id: string | null;
}

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

export type EntryType = "top_up" | "class_deduction" | "refund" | "bonus" | "expiration" | "adjustment" | "reversal";

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

export interface CreditPurchase {
  id: string;
  package_name: string;
  kind: PackageKind;
  credits: number;
  total_idr: number;
  discount_idr: number;
  channel: "member_portal" | "front_desk";
  payment_method: PaymentMethod | null;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  note: string | null;
  paid_at: string | null;
  created_at: string;
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
  sell: (customerId: string, input: { package_id: string; payment_method: PaymentMethod; discount_idr: number; note: string }) =>
    send<CreditPurchase>(`/api/gym/credits/${customerId}/sell`, input),
  reverse: (entryId: string, reason: string) => send("/api/gym/credits/reverse", { entry_id: entryId, reason }),
  refundPurchase: (purchaseId: string, reason: string) =>
    send<CreditPurchase>(`/api/gym/credits/purchases/${purchaseId}/refund`, { reason }),

  rules: () => call<RulesAdmin>("/api/gym/rules"),
  saveRules: (branchId: string | null, rules: Partial<GymRules>) =>
    send<RulesAdmin>("/api/gym/rules", { branch_id: branchId, rules }, "PUT"),
};

/* ── Label & format ──────────────────────────────────────────────────── */

export const ENTRY_LABELS: Record<EntryType, string> = {
  top_up: "Beli paket",
  class_deduction: "Booking kelas",
  refund: "Refund kelas",
  bonus: "Bonus",
  expiration: "Kedaluwarsa",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
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
