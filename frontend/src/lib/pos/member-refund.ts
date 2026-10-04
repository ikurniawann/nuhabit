import { formatRupiah } from "@/lib/format";
/**
 * Refund saldo member (owner 2026-09-04): dari halaman Unlink Card, tombol
 * "Refund" = kartu dilepas + permintaan refund dicatat. Setelah Finance
 * mengonfirmasi uang sudah dikembalikan, permintaan ditandai "Refund
 * Completed" (PIN supervisor) dan saldo ARK member di-nol-kan.
 */

export const REFUND_STATUSES = ["requested", "completed", "cancelled"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: "Menunggu Finance",
  completed: "Refund Completed",
  cancelled: "Dibatalkan",
};

/** Tipe transaksi wallet saat saldo dikembalikan ke member (uang keluar). */
export const REFUND_WALLET_TYPE = "withdrawal";
export const REFUND_WALLET_METHOD = "refund";

export function normalizeNotes(input: unknown, max = 500): { ok: true; notes: string | null } | { ok: false; error: string } {
  const notes = String(input ?? "").trim();
  if (notes.length > max) return { ok: false, error: `Keterangan maksimal ${max} karakter` };
  return { ok: true, notes: notes || null };
}

/** Pure: permintaan boleh diselesaikan/dibatalkan hanya bila masih 'requested'. */
export function isRefundOpen(status: string | null | undefined): boolean {
  return status === "requested";
}

/** Pure: catatan transaksi wallet saat refund selesai. */
export function buildRefundWalletNotes(input: { approverName?: string | null; requestId: string }): string {
  return `Refund saldo member (kartu dilepas) — disetujui ${input.approverName || "supervisor"} · permintaan ${input.requestId.slice(0, 8)}`;
}

/** Pure: pesan sukses untuk kasir. */
export function refundCompletedMessage(input: { name?: string | null; phone?: string | null; amount: number }): string {
  const who = input.name || input.phone || "member";
  return `Refund ${who} selesai — ${formatRupiah(input.amount)} dikembalikan, saldo member kini Rp0`;
}
