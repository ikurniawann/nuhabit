// Alur halaman top-up ARK sebagai reducer murni: pilih member → nominal →
// metode → (QRIS menunggu) → sukses. Komponen hanya men-dispatch aksi.
import { formatNumber } from "@/lib/format";
import type { TopupPackage } from "@/features/wallet/api";
import type { PaymentMethod, TopupCustomer, TopupHistoryItem, TopupResult, TopupStatus } from "./types";

export type TopupFlowState = {
  step: TopupStatus;
  customer: TopupCustomer | null;
  /** Harga yang dibayar (Rupiah). */
  topupRp: number;
  /** Teks input nominal (dikelompokkan ribuan). */
  customRp: string;
  /** Paket terpilih: harga = topupRp, saldo diterima = credit_idr. */
  topupPackage: TopupPackage | null;
  payment: PaymentMethod;
  result: TopupResult | null;
  pendingTopupId: string | null;
  error: string;
};

export type TopupFlowAction =
  | { type: "customerSelected"; customer: TopupCustomer }
  | { type: "packageSelected"; pkg: TopupPackage }
  | { type: "presetSelected"; value: number }
  | { type: "customAmountTyped"; raw: string }
  | { type: "back" }
  | { type: "continueToPayment"; minTopup: number }
  | { type: "paymentChosen"; payment: PaymentMethod }
  | { type: "errorShown"; message: string }
  | { type: "submitStarted" }
  | { type: "submitFailed"; message: string }
  | { type: "qrisIssued"; result: TopupResult }
  | { type: "succeeded"; result: TopupResult }
  | { type: "topupCancelled"; topupId: string }
  | { type: "qrisResumed"; topupId: string; amount: number; result: TopupResult }
  | { type: "balanceUpdated"; balance: number }
  | { type: "newTopup" };

export const initialTopupFlow: TopupFlowState = {
  step: "idle",
  customer: null,
  topupRp: 0,
  customRp: "",
  topupPackage: null,
  payment: "qris",
  result: null,
  pendingTopupId: null,
  error: "",
};

/** Ambil digit saja dari input nominal ("Rp 50.000" → 50000). */
export function parseAmountInput(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  return Number.parseInt(digits, 10) || 0;
}

const amountText = (amount: number) => (amount > 0 ? formatNumber(amount) : "");

/** Saldo yang masuk: kredit paket bila ada, selain itu nominal bayar. */
export function creditOf(state: Pick<TopupFlowState, "topupPackage" | "topupRp">): number {
  return state.topupPackage?.credit_idr ?? state.topupRp;
}

export function projectedBalanceOf(state: TopupFlowState): number {
  return state.customer ? Number(state.customer.ark_coin_balance || 0) + creditOf(state) : 0;
}

function withAmount(state: TopupFlowState, amount: number, pkg: TopupPackage | null): TopupFlowState {
  return { ...state, topupPackage: pkg, topupRp: amount, customRp: amountText(amount) };
}

export function topupFlowReducer(state: TopupFlowState, action: TopupFlowAction): TopupFlowState {
  switch (action.type) {
    case "customerSelected":
      return {
        ...state,
        customer: action.customer,
        step: "enter_amount",
        topupRp: 0,
        customRp: "",
        result: null,
        error: "",
        pendingTopupId: null,
      };
    case "packageSelected":
      return withAmount(state, action.pkg.price_idr, action.pkg);
    case "presetSelected":
      return withAmount(state, action.value, null);
    case "customAmountTyped":
      return withAmount(state, parseAmountInput(action.raw), null);
    case "back":
      if (state.step === "enter_amount") return { ...state, error: "", step: "idle", customer: null };
      if (state.step === "payment" || state.step === "awaiting_qris") {
        return { ...state, error: "", step: "enter_amount" };
      }
      return { ...state, error: "" };
    case "continueToPayment":
      return state.topupRp >= action.minTopup ? { ...state, step: "payment" } : state;
    case "paymentChosen":
      return { ...state, payment: action.payment };
    case "errorShown":
      return { ...state, error: action.message };
    case "submitStarted":
      return { ...state, step: "processing", error: "" };
    case "submitFailed":
      return { ...state, step: "payment", error: action.message };
    case "qrisIssued":
      return {
        ...state,
        result: action.result,
        pendingTopupId: action.result.topup_id || action.result.transaction?.id || null,
        step: "awaiting_qris",
      };
    case "succeeded": {
      if (!state.customer) return state;
      const balance = Number(action.result.balance_after || projectedBalanceOf(state));
      return {
        ...state,
        result: action.result,
        customer: { ...state.customer, ark_coin_balance: balance },
        pendingTopupId: null,
        step: "success",
      };
    }
    case "topupCancelled":
      if (state.pendingTopupId !== action.topupId) return state;
      return { ...state, pendingTopupId: null, result: null, payment: "qris", step: "enter_amount" };
    case "qrisResumed":
      return {
        ...withAmount(state, action.amount, null),
        payment: "qris",
        pendingTopupId: action.topupId,
        result: action.result,
        step: "awaiting_qris",
      };
    case "balanceUpdated":
      return state.customer
        ? { ...state, customer: { ...state.customer, ark_coin_balance: action.balance } }
        : state;
    case "newTopup":
      return { ...withAmount(state, 0, null), result: null, pendingTopupId: null, step: "enter_amount" };
  }
}

/** Estimasi XP top-up untuk ditampilkan sebelum bayar (aturan sama dengan server). */
export function estimateTopupXp(
  amount: number,
  settings: { topup_xp_mode?: string; topup_xp_value: number; topup_xp_amount_step: number }
): number {
  if (settings.topup_xp_mode === "fixed") return Math.floor(settings.topup_xp_value);
  return Math.floor(amount / Math.max(1, settings.topup_xp_amount_step)) * settings.topup_xp_value;
}

/** Riwayat: hanya top-up QRIS pending yang bisa ditampilkan ulang / dicek / dibatalkan. */
export function canResumeQris(item: TopupHistoryItem): boolean {
  const type = String(item.type || "topup").toLowerCase();
  return (
    type === "topup" &&
    String(item.status || "").toLowerCase() === "pending" &&
    String(item.payment_method || "").toLowerCase() === "qris"
  );
}

export function paymentMethodLabel(method?: string | null): string {
  const value = String(method || "").toLowerCase();
  if (value === "cash") return "Cash";
  if (value === "qris") return "QRIS";
  if (value === "foc") return "FOC (Gratis)";
  if (value === "credit" || value === "credit_card") return "Card";
  if (!value) return "—";
  return value.toUpperCase();
}

const WALLET_TYPE_LABELS: Record<string, string> = {
  topup: "Top-up",
  topup_bonus: "Bonus top-up",
  payment: "Pemakaian",
  refund: "Refund",
  bonus: "Bonus",
  redeem: "Redeem",
  expiration: "Kedaluwarsa",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
  topup_refund: "Refund top-up",
  withdrawal: "Penarikan",
};

export function walletTypeLabel(type?: string | null): string {
  const value = String(type || "topup").toLowerCase();
  return WALLET_TYPE_LABELS[value] ?? value;
}

export function walletTypeBadgeClass(type?: string | null): string {
  const value = String(type || "topup").toLowerCase();
  if (value === "payment" || value === "redeem") return "bg-red-50 text-red-700 ring-1 ring-red-200/70";
  if (value === "refund") return "bg-sky-50 text-sky-700 ring-1 ring-sky-200/70";
  if (value === "topup_bonus" || value === "bonus") return "bg-violet-50 text-violet-700 ring-1 ring-violet-200/70";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70";
}

export function statusLabel(status?: string | null): string {
  const value = String(status || "completed").toLowerCase();
  if (value === "pending") return "Pending";
  if (value === "failed") return "Failed";
  if (value === "expired") return "Expired";
  if (value === "cancelled") return "Cancelled";
  return "Completed";
}

export function statusBadgeClass(status?: string | null): string {
  const value = String(status || "completed").toLowerCase();
  if (value === "pending") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80";
  if (value === "failed" || value === "expired" || value === "cancelled") {
    return "bg-red-50 text-red-700 ring-1 ring-red-200/80";
  }
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80";
}
