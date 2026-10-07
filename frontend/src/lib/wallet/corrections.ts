/**
 * Validasi koreksi admin dompet (pure): penyesuaian manual, pembatalan entri,
 * refund top-up. Server menjalankan hasilnya di dalam transaksi dengan saldo
 * member terkunci.
 */
import { isCompleted, isLotRow, roundIdr, signedDelta, type LedgerRow, type LotAllocation } from "./ledger";

const MAX_ADJUSTMENT_IDR = 100_000_000;
const MIN_REASON_LENGTH = 5;

export const REFUND_METHODS = ["cash", "transfer", "other"] as const;

type Invalid = { ok: false; error: string };

function checkReason(reason: string): Invalid | null {
  return reason.trim().length < MIN_REASON_LENGTH
    ? { ok: false, error: `Alasan wajib diisi (minimal ${MIN_REASON_LENGTH} karakter)` }
    : null;
}

function wouldGoNegative(balance: number, delta: number): Invalid | null {
  return roundIdr(balance + delta) < 0
    ? { ok: false, error: "Saldo member tidak cukup: koreksi ini membuat saldo minus" }
    : null;
}

export function validateAdjustment(input: {
  amount: number;
  reason: string;
  balance: number;
}): { ok: true; delta: number } | Invalid {
  const amount = roundIdr(Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0) return { ok: false, error: "Nominal penyesuaian tidak boleh 0" };
  if (Math.abs(amount) > MAX_ADJUSTMENT_IDR) return { ok: false, error: "Nominal penyesuaian melebihi batas Rp 100.000.000" };
  return checkReason(input.reason) ?? wouldGoNegative(input.balance, amount) ?? { ok: true, delta: amount };
}

const NOT_REVERSIBLE: Record<string, string> = {
  reversal: "Entri pembatalan tidak bisa dibatalkan lagi",
  topup_refund: "Refund top-up tidak bisa dibatalkan; gunakan penyesuaian manual",
};

export function validateReversal(input: {
  entry: LedgerRow;
  reason: string;
  balance: number;
  alreadyReversed: boolean;
}): { ok: true; delta: number; allocations: LotAllocation[] } | Invalid {
  const { entry } = input;
  if (NOT_REVERSIBLE[entry.type]) return { ok: false, error: NOT_REVERSIBLE[entry.type] };
  if (!isCompleted(entry)) return { ok: false, error: "Hanya entri berstatus selesai yang bisa dibatalkan" };
  if (input.alreadyReversed) return { ok: false, error: "Entri ini sudah pernah dibatalkan" };
  if (entry.metadata?.refunded_at) return { ok: false, error: "Top-up ini sudah direfund" };
  const original = signedDelta(entry);
  if (original === 0) return { ok: false, error: "Entri tanpa nominal tidak bisa dibatalkan" };
  const delta = roundIdr(-original);
  const allocations = isLotRow(entry) ? [{ lot_id: entry.id, amount: original }] : [];
  return checkReason(input.reason) ?? wouldGoNegative(input.balance, delta) ?? { ok: true, delta, allocations };
}

/**
 * Refund satu top-up: kredit top-up beserta bonusnya ditarik dari saldo, uang
 * (harga yang dibayar) dikembalikan di luar sistem. QRIS Xendit tidak punya
 * API refund, jadi selalu dicatat sebagai refund manual.
 */
export function validateTopupRefund(input: {
  topup: LedgerRow & { payment_method?: string | null };
  bonus: LedgerRow | null;
  balance: number;
  alreadyRefunded: boolean;
  alreadyReversed: boolean;
  method: string;
  reason: string;
}):
  | { ok: true; removeIdr: number; refundIdr: number; manual: boolean; allocations: LotAllocation[] }
  | Invalid {
  const { topup, bonus } = input;
  if (topup.type !== "topup") return { ok: false, error: "Hanya entri top-up yang bisa direfund" };
  if (!isCompleted(topup)) return { ok: false, error: "Top-up belum selesai; batalkan transaksi pending dari kasir" };
  const method = String(topup.payment_method ?? "").toLowerCase();
  if (method === "foc") return { ok: false, error: "Top-up FOC tidak dibayar; gunakan pembatalan entri" };
  if (input.alreadyRefunded || topup.metadata?.refunded_at) return { ok: false, error: "Top-up ini sudah direfund" };
  if (input.alreadyReversed) return { ok: false, error: "Top-up ini sudah dibatalkan" };
  if (!(REFUND_METHODS as readonly string[]).includes(input.method)) {
    return { ok: false, error: "Metode refund tidak valid" };
  }
  const topupIdr = signedDelta(topup);
  const bonusIdr = bonus && isCompleted(bonus) ? signedDelta(bonus) : 0;
  const removeIdr = roundIdr(topupIdr + bonusIdr);
  const allocations: LotAllocation[] = [{ lot_id: topup.id, amount: topupIdr }];
  if (bonus && bonusIdr > 0) allocations.push({ lot_id: bonus.id, amount: bonusIdr });
  return (
    checkReason(input.reason) ??
    wouldGoNegative(input.balance, -removeIdr) ?? {
      ok: true,
      removeIdr,
      refundIdr: topupIdr,
      manual: method === "qris",
      allocations,
    }
  );
}
