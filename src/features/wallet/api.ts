/** Klien API dompet member (POS → Member → Dompet). */
import { isCreditEntry } from "@/lib/wallet/ledger";
import type { TopupPackage, PackageInput } from "@/lib/wallet/packages";
import type { WalletSettings } from "@/lib/wallet/server";

export type { TopupPackage, PackageInput, WalletSettings };

export interface WalletEntry {
  id: string;
  type: string;
  status: string | null;
  amount: number;
  balance_before: number;
  balance_after: number;
  payment_method: string | null;
  reference_id: string | null;
  xendit_transaction_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
}

export interface WalletLot {
  id: string;
  type: string;
  amount: number;
  remaining: number;
  created_at: string;
  expires_at: string | null;
}

export interface WalletMember {
  id: string;
  name: string | null;
  phone: string;
  balance: number;
}

export interface MemberWallet {
  member: WalletMember;
  lots: WalletLot[];
  entries: WalletEntry[];
}

export interface OnlinePayment {
  id: string;
  status: string;
  amount: number;
  xendit_transaction_id: string | null;
  reference_id: string | null;
  created_at: string;
  paid_at: string | null;
  source: "cashier" | "member";
  package_name: string | null;
  environment: string | null;
  simulated: boolean;
  refunded_at: string | null;
  customer_id: string;
  member_name: string | null;
  member_phone: string | null;
}

export interface PaymentFilters {
  status?: string;
  source?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface SweepRun {
  id: string;
  trigger: "auto" | "manual";
  started_at: string;
  finished_at: string | null;
  expired_lots: number;
  expired_idr: number;
  reminders_sent: number;
  nudges_sent: number;
  error: string | null;
}

export type ReconcileOutcome = { status: string; detail?: string; balance_after?: number };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return json.data as T;
}

const send = <T>(method: string, url: string, body: unknown) => call<T>(url, { method, body: JSON.stringify(body) });

export const walletApi = {
  packages: (scope?: "cashier") => call<TopupPackage[]>(`/api/wallet/packages${scope ? `?scope=${scope}` : ""}`),
  savePackage: (id: string | null, input: PackageInput) =>
    id ? send<TopupPackage>("PUT", `/api/wallet/packages/${id}`, input) : send<TopupPackage>("POST", "/api/wallet/packages", input),
  deactivatePackage: (id: string) => call<{ id: string }>(`/api/wallet/packages/${id}`, { method: "DELETE" }),

  branches: () => call<{ id: string; name: string }[]>("/api/wallet/branches"),

  settings: () => call<WalletSettings>("/api/wallet/settings"),
  saveSettings: (input: Omit<WalletSettings, "ark_rate" | "topup_min_amount">) =>
    send<WalletSettings>("PUT", "/api/wallet/settings", input),

  searchMembers: (q: string) => call<WalletMember[]>(`/api/wallet/members?q=${encodeURIComponent(q)}`),
  memberWallet: (id: string) => call<MemberWallet>(`/api/wallet/members/${id}`),
  adjust: (id: string, amount: number, reason: string) =>
    send<WalletEntry>("POST", `/api/wallet/members/${id}/adjust`, { amount, reason }),
  reverse: (entryId: string, reason: string) => send<WalletEntry>("POST", `/api/wallet/entries/${entryId}/reverse`, { reason }),
  refund: (entryId: string, input: { method: string; reference: string; reason: string }) =>
    send<WalletEntry>("POST", `/api/wallet/entries/${entryId}/refund`, input),

  payments: (filters: PaymentFilters) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    return call<{ payments: OnlinePayment[]; summary: { status: string; count: number; amount: number }[] }>(
      `/api/wallet/payments?${qs}`
    );
  },
  payment: (id: string) =>
    call<{ payment: WalletEntry & { customer_id: string }; member: WalletMember | null; related: WalletEntry[] }>(
      `/api/wallet/payments/${id}`
    ),
  reconcile: (id: string) => send<ReconcileOutcome>("POST", `/api/wallet/payments/${id}/reconcile`, {}),

  sweepRuns: () => call<SweepRun[]>("/api/wallet/sweep"),
  runSweep: () =>
    send<{ status: "done" | "busy"; expired_lots: number; expired_idr: number; reminders_sent: number; nudges_sent: number }>(
      "POST",
      "/api/wallet/sweep",
      {}
    ),
};

/** Mutasi bertanda untuk tampilan (amount tersimpan tidak selalu bertanda). */
export const entryDelta = (e: { type: string; amount: number }) =>
  isCreditEntry(e.type, e.amount) ? Math.abs(e.amount) : -Math.abs(e.amount);

export const angka = (n: number) => Number(n || 0).toLocaleString("id-ID");
export const rupiah = (n: number) => `Rp ${angka(Math.round(n))}`;
export const signedRupiah = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${rupiah(Math.abs(n))}`;
export const waktu = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })
    : "—";
export const tanggal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }) : "Tidak kedaluwarsa";

export const ENTRY_LABELS: Record<string, string> = {
  topup: "Top-up",
  topup_bonus: "Bonus top-up",
  bonus: "Bonus",
  refund: "Refund order",
  payment: "Pembayaran",
  withdrawal: "Penarikan saldo",
  redeem: "Redeem",
  expiration: "Kedaluwarsa",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
  topup_refund: "Refund top-up",
};

export const STATUS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "muted" | "destructive" }> = {
  completed: { label: "Lunas", variant: "success" },
  pending: { label: "Menunggu", variant: "warning" },
  expired: { label: "Kedaluwarsa", variant: "muted" },
  cancelled: { label: "Dibatalkan", variant: "muted" },
  failed: { label: "Gagal", variant: "destructive" },
};
