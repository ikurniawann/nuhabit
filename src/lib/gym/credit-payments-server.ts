/**
 * Pembayaran paket kredit dari portal member: QRIS dinamis Xendit (pola
 * yang sama dengan top-up ARK) atau saldo ARK Coin. Kredit terbit hanya
 * saat pembayaran lunas, lewat markCreditPurchasePaid.
 */
import { randomUUID } from "node:crypto";
import { getPool, withTransaction } from "@/lib/db";
import { createXenditDynamicQr, getXenditQrPayments, loadActiveXenditConfig } from "@/lib/payments/xendit";
import { pickPaidXenditPayment } from "@/lib/pos/topup-qris-reconcile";
import { canSimulateTopup } from "@/lib/wallet/member-topup";
import { GymCreditError } from "./credits-server";
import {
  closeCreditPurchase,
  createCreditPurchase,
  loadCreditPurchase,
  markCreditPurchasePaid,
  payCreditPurchaseWithArk,
  type CreditPurchaseRow,
} from "./credit-purchases-server";

/** Prefix reference_id QRIS pembelian paket gym; webhook Xendit bercabang dari sini. */
export const GYM_PURCHASE_REF_PREFIX = "gymcp_";
const QR_DISPLAY_TTL_MS = 30 * 60_000;

export const isGymPurchaseReference = (referenceId: string) => referenceId.startsWith(GYM_PURCHASE_REF_PREFIX);

export function memberPurchaseView(row: CreditPurchaseRow) {
  const meta = row.payment_meta ?? {};
  return {
    id: row.id,
    status: row.status,
    package_id: row.package_id,
    package_name: row.package_name,
    credits: row.credits,
    total_idr: row.total_idr,
    payment_method: row.payment_method,
    qr_string: row.status === "pending" ? ((meta.qr_string as string | undefined) ?? null) : null,
    expires_at: (meta.expires_at as string | undefined) ?? null,
    simulated: meta.simulated === true,
    paid_at: row.paid_at,
    created_at: row.created_at,
  };
}

/** Beli paket dengan saldo ARK Coin: debit + kredit terbit dalam satu transaksi. */
export function buyPackageWithArk(customerId: string, packageId: string) {
  return withTransaction(async (client) => {
    const purchase = await createCreditPurchase(client, {
      customerId,
      packageId,
      channel: "member_portal",
      paymentMethod: "ark_coin",
    });
    const { purchase: paid } = await payCreditPurchaseWithArk(client, purchase);
    return memberPurchaseView(paid);
  });
}

/**
 * Beli paket via QRIS. Tanpa gateway aktif hanya dev lokal (pengaman
 * dev-bypass yang sama dengan top-up) yang mendapat QR simulasi.
 */
export async function startQrisPurchase(input: {
  customerId: string;
  packageId: string;
  callbackUrl: (configured: string | null) => string;
}) {
  const referenceId = `${GYM_PURCHASE_REF_PREFIX}${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const purchase = await withTransaction((client) =>
    createCreditPurchase(client, {
      customerId: input.customerId,
      packageId: input.packageId,
      channel: "member_portal",
      paymentMethod: "qris",
    })
  );
  if (purchase.total_idr <= 0) {
    const paid = await withTransaction((client) => markCreditPurchasePaid(client, purchase.id, { provider: "free" }));
    return memberPurchaseView(paid.purchase);
  }

  let meta: Record<string, unknown>;
  try {
    const xendit = await loadActiveXenditConfig().catch((error: unknown) => {
      if (canSimulateTopup()) return null;
      throw new GymCreditError(
        `Pembayaran QRIS belum tersedia: ${error instanceof Error ? error.message : "gateway belum dikonfigurasi"}`,
        503
      );
    });
    const qr = xendit
      ? await createXenditDynamicQr({
          secretKey: xendit.secretKey,
          referenceId,
          amount: purchase.total_idr,
          callbackUrl: input.callbackUrl(xendit.callbackUrl),
          description: `Paket kredit ${purchase.package_name}`,
        })
      : null;
    meta = {
      provider: qr ? "xendit" : "dev_simulated",
      environment: xendit?.environment ?? "local",
      qr_id: qr?.id ?? null,
      qr_string: qr?.qr_string ?? `DEV-SIMULATED-QRIS-${referenceId}`,
      expires_at: qr?.expires_at ?? new Date(Date.now() + QR_DISPLAY_TTL_MS).toISOString(),
      simulated: !qr,
    };
  } catch (error) {
    await closeCreditPurchase(getPool(), purchase.id, "failed");
    throw error;
  }

  await getPool().query(
    `UPDATE gym.credit_purchases SET external_id = $2, payment_meta = payment_meta || $3::jsonb, updated_at = now()
      WHERE id = $1`,
    [purchase.id, referenceId, JSON.stringify(meta)]
  );
  return memberPurchaseView((await loadCreditPurchase(getPool(), purchase.id))!);
}

/** Webhook Xendit: lunasi pembelian berdasarkan reference_id. */
export async function settleGymPurchaseByReference(referenceId: string, paymentId: string | null) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT id FROM gym.credit_purchases WHERE external_id = $1`, [referenceId]);
    if (!rows[0]) return { status: "not_found" as const };
    const result = await markCreditPurchasePaid(client, rows[0].id, { xendit_payment_id: paymentId });
    return { status: result.status, purchase_id: rows[0].id as string };
  });
}

/**
 * Status pembelian milik member untuk polling. Selagi pending, tanya Xendit
 * langsung (webhook bisa terlambat); QR yang lewat masa berlaku ditutup.
 */
export async function refreshMemberPurchase(customerId: string, purchaseId: string) {
  const pool = getPool();
  const row = await loadCreditPurchase(pool, purchaseId);
  if (!row || row.customer_id !== customerId) return null;
  if (row.status !== "pending") return memberPurchaseView(row);

  const qrId = row.payment_meta.qr_id as string | null | undefined;
  if (qrId) {
    try {
      const config = await loadActiveXenditConfig();
      const paid = pickPaidXenditPayment(await getXenditQrPayments(config.secretKey, qrId));
      if (paid) {
        const settled = await withTransaction((client) =>
          markCreditPurchasePaid(client, purchaseId, { xendit_payment_id: paid.id, reconciled: true })
        );
        return memberPurchaseView(settled.purchase);
      }
    } catch (error) {
      console.warn(`[gym-credits] rekonsiliasi QR ${qrId} gagal:`, error instanceof Error ? error.message : error);
    }
  }
  const expiresAt = row.payment_meta.expires_at as string | undefined;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    await closeCreditPurchase(pool, purchaseId, "expired");
    return memberPurchaseView((await loadCreditPurchase(pool, purchaseId))!);
  }
  return memberPurchaseView(row);
}

/** KHUSUS DEV LOKAL: lunasi QR simulasi lewat jalur yang sama dengan webhook. */
export async function simulateMemberPurchasePaid(customerId: string, purchaseId: string) {
  const row = await loadCreditPurchase(getPool(), purchaseId);
  if (!row || row.customer_id !== customerId) return null;
  const result = await withTransaction((client) =>
    markCreditPurchasePaid(client, purchaseId, { xendit_payment_id: `dev_sim_${purchaseId}` })
  );
  return memberPurchaseView(result.purchase);
}
