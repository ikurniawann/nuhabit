/**
 * QRIS Xendit utk order self-order meja — memakai pola yang sama dengan
 * POST /api/pos/qris (QR terikat SATU order, reference `pos-ord-<orderId>`,
 * reuse bila sudah ada) supaya webhook Xendit yang ada
 * (/api/payments/xendit/webhook → settleOrderQrisPayment) otomatis mengenali
 * dan melunasi order tanpa kode tambahan.
 */

import type { DbClient } from "@/lib/pg/types";
import {
  createXenditDynamicQr,
  getXenditQrCode,
  getXenditQrCodeByReferenceId,
  getXenditQrPayments,
  isXenditQrPaid,
  type XenditGatewayConfig,
} from "@/lib/payments/xendit";
import { resolveCheckoutQrisAction } from "@/lib/pos/create-mixed-checkout";
import { settleOrderQrisPayment } from "@/lib/pos/settle-order-qris";

export type OrderQrisRow = {
  id: string;
  order_number?: string | null;
  total_amount: number | string | null;
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
};

export type OrderQrisPayload = {
  qr_id: string;
  reference_id: string;
  qr_string: string;
  amount: number;
  expires_at: string | null;
};

function toPayload(
  row: Record<string, unknown> & { id: string },
  fallback: { referenceId: string; amount: number }
): OrderQrisPayload {
  return {
    qr_id: String(row.id),
    reference_id: String(row.reference_id || fallback.referenceId),
    qr_string: String(row.qr_string || ""),
    amount: Number(row.amount != null ? row.amount : fallback.amount) || fallback.amount,
    expires_at: row.expires_at ? String(row.expires_at) : null,
  };
}

/** Buat (atau pakai ulang) QR dinamis utk order; simpan id-nya di pos_orders. */
export async function ensureOrderQris(
  db: DbClient,
  order: OrderQrisRow,
  xendit: XenditGatewayConfig
): Promise<OrderQrisPayload> {
  const amount = Math.round(Number(order.total_amount) || 0);
  if (amount <= 0) throw new Error("Nominal QRIS tidak valid");
  const referenceId = `pos-ord-${order.id}`;

  const action = resolveCheckoutQrisAction({
    xendit_qr_id: order.xendit_qr_id ?? null,
    xendit_external_id: order.xendit_external_id ?? null,
  });

  if (action !== "create") {
    try {
      const reused =
        action === "reuse_qr_id"
          ? await getXenditQrCode(xendit.secretKey, String(order.xendit_qr_id))
          : await getXenditQrCodeByReferenceId(xendit.secretKey, String(order.xendit_external_id));
      const payload = toPayload(reused, { referenceId, amount });
      if (payload.qr_string) {
        if (!order.xendit_qr_id) {
          await db
            .from("pos_orders")
            .update({ xendit_qr_id: payload.qr_id, updated_at: new Date().toISOString() })
            .eq("id", order.id);
        }
        return payload;
      }
    } catch (error) {
      // Reservasi basi (QR gagal terbentuk sebelumnya) → lanjut buat baru.
      console.warn(
        `[table-order] qris reuse miss, membuat baru: order=${order.id}`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const { error: reserveError } = await db
    .from("pos_orders")
    .update({ xendit_external_id: referenceId, updated_at: new Date().toISOString() })
    .eq("id", order.id);
  if (reserveError) throw reserveError;

  const qr = await createXenditDynamicQr({
    secretKey: xendit.secretKey,
    referenceId,
    amount,
    callbackUrl: xendit.callbackUrl,
    description: `Self-order ${order.order_number || order.id}`,
  });

  const { error: saveError } = await db
    .from("pos_orders")
    .update({
      xendit_qr_id: qr.id,
      xendit_external_id: qr.reference_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (saveError) throw saveError;

  return {
    qr_id: qr.id,
    reference_id: qr.reference_id,
    qr_string: qr.qr_string,
    amount: qr.amount,
    expires_at: qr.expires_at ?? null,
  };
}

/**
 * Cek status QR di Xendit; kalau lunas → settle order (idempotent, sama
 * dengan jalur webhook). Dipakai polling layar pemesan sebagai cadangan bila
 * webhook terlambat/tidak sampai.
 */
export async function checkAndSettleOrderQris(
  db: DbClient,
  orderId: string,
  qrId: string,
  xendit: XenditGatewayConfig
): Promise<{ paid: boolean; status: string }> {
  const remote = await getXenditQrCode(xendit.secretKey, qrId);
  let paid = isXenditQrPaid(remote);
  let status = String(remote.status || remote.payment_status || "ACTIVE");

  if (!paid) {
    try {
      const payments = await getXenditQrPayments(xendit.secretKey, qrId);
      if (isXenditQrPaid({ payments })) {
        paid = true;
        status = "SUCCEEDED";
      }
    } catch {
      // endpoint payments opsional — detail QR sudah cukup
    }
  }

  if (paid) {
    await settleOrderQrisPayment(db, orderId);
  }
  return { paid, status };
}
