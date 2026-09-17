/**
 * Notifikasi WA komplimen (permintaan owner 2026-08-24): SETIAP transaksi
 * FOC atau Owner Comp yang disetujui langsung dikabarkan ke nomor owner —
 * komplimen adalah uang yang "keluar" tanpa pembayaran, jadi owner tahu
 * seketika siapa yang menyetujui dan berapa nilainya.
 *
 * Best-effort & tidak boleh mengganggu pembayaran: dipanggil fire-and-forget
 * setelah transaksi tersimpan; gagal kirim hanya tercatat di log server.
 * Dedup lewat configuration.wa_notif_log (notif_type 'komplimen') — kejadian
 * yang sama tidak pernah terkirim dua kali walau route terpanggil ulang.
 */

import { getPool } from "@/lib/db";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";

/** Nomor tujuan tetap — permintaan owner (081809078014 → format 62). */
export const COMP_NOTIF_TARGET = "6281809078014";

const COMP_NOTIF_TYPE = "komplimen";

export interface CompNotifInput {
  compType: "foc_comp" | "owner_comp";
  /** Nomor order (POS-…) atau checkout (CHK-…) yang dikomplimenkan. */
  orderNumber: string;
  /** Jumlah anak-order bila checkout gabungan (>1 → dicantumkan). */
  orderCount?: number;
  /** Nilai gross (subtotal) yang digratiskan, dalam Rupiah. */
  grossIdr: number;
  approvedName?: string | null;
  /** Nama customer bila sudah diketahui pemanggil. */
  customerName?: string | null;
  /** Bila nama belum ada: id pos_customers utk di-lookup sebelum kirim. */
  customerId?: string | null;
}

export function compNotifLabel(compType: CompNotifInput["compType"]): string {
  return compType === "foc_comp" ? "FOC (Free of Charge)" : "Owner Comp";
}

/** Pure & unit-testable — isi pesan WA-nya. */
export function buildCompNotifMessage(
  input: CompNotifInput,
  now: Date = new Date()
): string {
  const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const waktu = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const orderLine =
    input.orderCount && input.orderCount > 1
      ? `${input.orderNumber} (${input.orderCount} order)`
      : input.orderNumber;
  return [
    `BCD Coffee OS — Komplimen ${compNotifLabel(input.compType)}`,
    `Order : ${orderLine}`,
    `Customer : ${input.customerName?.trim() || "-"}`,
    `Nilai : ${rp(input.grossIdr)}`,
    `Disetujui : ${input.approvedName?.trim() || "-"}`,
    `${waktu} WIB`,
  ].join("\n");
}

/** Lookup nama customer (best-effort) bila pemanggil hanya punya id-nya. */
async function resolveCustomerName(input: CompNotifInput): Promise<string | null> {
  if (input.customerName?.trim()) return input.customerName.trim();
  if (!input.customerId) return null;
  try {
    const res = await getPool().query<{ name: string | null }>(
      `SELECT name FROM pos.pos_customers WHERE id = $1`,
      [input.customerId]
    );
    return res.rows[0]?.name?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Kirim notifikasinya — aman dipanggil fire-and-forget:
 * `void notifyCompTransaction(...)` (semua error tertelan ke console).
 */
export async function notifyCompTransaction(input: CompNotifInput): Promise<void> {
  try {
    const message = buildCompNotifMessage({
      ...input,
      customerName: await resolveCustomerName(input),
    });
    const dedupKey = `comp:${input.compType}:${input.orderNumber}`.slice(0, 160);
    await deliverOwnerNotif(dedupKey, message);
  } catch (err) {
    console.error("[wa-comp] notifikasi komplimen error:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Topup FOC (owner 2026-09-01): saldo ARK diberikan gratis utk        */
/* marketing — sama seperti komplimen, owner harus tahu seketika.      */
/* ------------------------------------------------------------------ */

export interface FocTopupNotifInput {
  /** id pos_wallet_transactions — kunci dedup. */
  transactionId: string;
  amountIdr: number;
  approvedName?: string | null;
  customerName?: string | null;
  customerId?: string | null;
}

/** Pure & unit-testable — isi pesan WA topup FOC. */
export function buildFocTopupMessage(
  input: FocTopupNotifInput,
  now: Date = new Date()
): string {
  const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const waktu = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
  return [
    "BCD Coffee OS — Topup FOC (Gratis)",
    `Customer : ${input.customerName?.trim() || "-"}`,
    `Saldo ARK : ${rp(input.amountIdr)} (tanpa pembayaran, tanpa XP)`,
    `Disetujui : ${input.approvedName?.trim() || "-"}`,
    `${waktu} WIB`,
  ].join("\n");
}

/** Fire-and-forget: `void notifyFocTopup(...)`. */
export async function notifyFocTopup(input: FocTopupNotifInput): Promise<void> {
  try {
    const message = buildFocTopupMessage({
      ...input,
      customerName: await resolveCustomerName({
        compType: "foc_comp",
        orderNumber: "",
        grossIdr: 0,
        customerName: input.customerName,
        customerId: input.customerId,
      }),
    });
    await deliverOwnerNotif(`foc-topup:${input.transactionId}`.slice(0, 160), message);
  } catch (err) {
    console.error("[wa-comp] notifikasi topup FOC error:", err);
  }
}

/**
 * Pengiriman bersama (komplimen & topup FOC): klaim dedup dulu, kirim ke
 * nomor owner, lepas klaim bila gagal jelas (timeout = at-most-once).
 */
async function deliverOwnerNotif(dedupKey: string, message: string): Promise<void> {
  {
    // Klaim dedup SEBELUM kirim — route terpanggil dua kali → satu pesan.
    const claim = await getPool().query<{ id: string }>(
      `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (notif_type, dedup_key) DO NOTHING
       RETURNING id`,
      [COMP_NOTIF_TYPE, dedupKey, message, JSON.stringify([COMP_NOTIF_TARGET])]
    );
    if (claim.rows.length === 0) return; // duplikat — sudah pernah terkirim

    const release = () =>
      getPool()
        .query(`DELETE FROM configuration.wa_notif_log WHERE id = $1`, [
          claim.rows[0].id,
        ])
        .catch(() => {});

    const gateway = await loadGatewayConfig();
    if (!gateway) {
      console.warn("[wa-comp] gateway belum dikonfigurasi — notifikasi komplimen dilewati");
      await release();
      return;
    }

    const result = await sendGatewayText(gateway, {
      target: COMP_NOTIF_TARGET,
      message,
    });
    if (!result.success && !result.timedOut) {
      // Gagal jelas → lepas klaim; timeout (status tak pasti) → at-most-once.
      console.error(`[wa-comp] gagal kirim ke ${COMP_NOTIF_TARGET}: ${result.reason}`);
      await release();
    }
  }
}
