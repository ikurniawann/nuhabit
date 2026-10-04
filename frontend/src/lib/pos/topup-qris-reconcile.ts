import type { DbClient } from "@/lib/pg/types";
import { creditPendingTopup } from "@/lib/pos/topup-credit";
import {
  getXenditQrCode,
  getXenditQrPayments,
  isXenditQrPaid,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";

/**
 * Rekonsiliasi topup QRIS yang masih 'pending' langsung ke Xendit (insiden
 * owner 2026-09-04: uang sudah terpotong di bank, webhook tidak sampai,
 * layar QRIS berputar terus, saldo tidak masuk).
 *
 * Sumber kebenaran = daftar PEMBAYARAN QR (GET /qr_codes/{id}/payments).
 * Objek QR sendiri setelah dibayar hanya berubah jadi INACTIVE tanpa info
 * pembayaran — itu sebabnya pengecekan lama tidak pernah mengkredit.
 * Dipakai oleh: polling status halaman topup, tombol "Cek pembayaran",
 * dan pengawas berkala (setiap 2 menit) sebagai jaring pengaman terakhir.
 */

const PAID = new Set(["SUCCEEDED", "SUCCESS", "COMPLETED", "PAID"]);

/** Pure: pilih pembayaran yang sudah berhasil dari daftar payments Xendit. */
export function pickPaidXenditPayment(
  rows: Record<string, unknown>[]
): { id: string; amount: number } | null {
  for (const row of rows) {
    const status = String(row.status || "").toUpperCase();
    if (!PAID.has(status)) continue;
    return {
      id: String(row.id || row.payment_id || ""),
      amount: Number(row.amount) || 0,
    };
  }
  return null;
}

export type ReconcileOutcome =
  | { status: "credited"; balance_before: number; balance_after: number; ark_coins: number; ark_rate?: number; xp_awarded: number; transaction: unknown; payment_id: string }
  | { status: "already_completed"; transaction: unknown; balance_after: number }
  | { status: "pending"; detail: string }
  | { status: "not_found" }
  | { status: "not_qris" }
  | { status: "error"; detail: string };

export async function reconcilePendingTopup(
  db: DbClient,
  transactionId: string
): Promise<ReconcileOutcome> {
  const { data: tx, error } = await db
    .from("pos_wallet_transactions")
    .select("id, status, type, payment_method, xendit_transaction_id, reference_id, amount")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) return { status: "error", detail: error.message };
  if (!tx) return { status: "not_found" };

  const row = tx as {
    status?: string; type?: string; payment_method?: string;
    xendit_transaction_id?: string | null; amount?: number | string;
  };
  if (String(row.status || "") === "completed") {
    return { status: "already_completed", transaction: tx, balance_after: 0 };
  }
  if (String(row.status || "") !== "pending" || String(row.payment_method || "").toLowerCase() !== "qris") {
    return { status: "not_qris" };
  }
  const qrId = String(row.xendit_transaction_id || "");
  if (!qrId) return { status: "pending", detail: "QR id Xendit tidak tercatat" };

  let config;
  try {
    config = await loadActiveXenditConfig(db);
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : "Xendit belum dikonfigurasi" };
  }

  // 1) Daftar pembayaran QR — jalur paling andal.
  let paid: { id: string; amount: number } | null = null;
  try {
    paid = pickPaidXenditPayment(await getXenditQrPayments(config.secretKey, qrId));
  } catch (err) {
    console.warn(`[topup-reconcile] gagal baca payments QR ${qrId}:`, err instanceof Error ? err.message : err);
  }
  // 2) Cadangan: objek QR yang menyertakan payment_status/payments.
  if (!paid) {
    try {
      const remote = await getXenditQrCode(config.secretKey, qrId);
      if (isXenditQrPaid(remote)) {
        paid = { id: String((remote as { payment_id?: string }).payment_id || remote.id), amount: Number(remote.amount) || 0 };
      }
    } catch (err) {
      console.warn(`[topup-reconcile] gagal baca QR ${qrId}:`, err instanceof Error ? err.message : err);
    }
  }
  if (!paid) return { status: "pending", detail: "Belum ada pembayaran berhasil tercatat di Xendit" };

  const credited = await creditPendingTopup(db, {
    transactionId,
    xenditPaymentId: paid.id,
    notes: "Top-up QRIS (rekonsiliasi Xendit)",
  });
  if (credited.status === "completed") {
    console.info(`[topup-reconcile] topup ${transactionId} dikredit dari payment ${paid.id}`);
    return {
      status: "credited",
      balance_before: credited.balance_before,
      balance_after: credited.balance_after,
      ark_coins: credited.ark_coins,
      ark_rate: credited.ark_rate,
      xp_awarded: credited.xp_awarded,
      transaction: credited.transaction,
      payment_id: paid.id,
    };
  }
  if (credited.status === "already_completed") {
    return { status: "already_completed", transaction: credited.transaction, balance_after: credited.balance_after };
  }
  return { status: "pending", detail: `Status transaksi ${credited.status}` };
}

/** Sapu semua topup QRIS pending (≤ maxAgeHours) — dipakai pengawas berkala. */
export async function reconcileAllPendingTopups(
  db: DbClient,
  maxAgeHours = 48
): Promise<{ checked: number; credited: number; errors: number }> {
  const since = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  const { data, error } = await db
    .from("pos_wallet_transactions")
    .select("id, xendit_transaction_id, payment_method, created_at")
    .eq("type", "topup")
    .eq("status", "pending")
    .gte("created_at", since);
  if (error) throw error;
  const rows = ((data || []) as { id: string; xendit_transaction_id?: string | null; payment_method?: string }[])
    .filter((r) => r.xendit_transaction_id && String(r.payment_method || "").toLowerCase() === "qris");

  let credited = 0;
  let errors = 0;
  for (const r of rows) {
    const outcome = await reconcilePendingTopup(db, r.id);
    if (outcome.status === "credited") credited += 1;
    if (outcome.status === "error") errors += 1;
  }
  return { checked: rows.length, credited, errors };
}
