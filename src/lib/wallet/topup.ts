/**
 * Top-up dompet: paket, bonus paket, dan pembuatan QRIS dinamis Xendit yang
 * dipakai kasir maupun top-up mandiri member (satu jalur yang sama).
 */
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { createXenditDynamicQr, loadActiveXenditConfig } from "@/lib/payments/xendit";
import { roundIdr } from "./ledger";
import { packageAvailableAt, packageBonus, type PackageInput, type TopupPackage } from "./packages";
import { insertWalletRow, lockCustomer, setCustomerBalance, WalletError, WALLET_COLUMNS, type WalletRow } from "./server";

/* ── Paket ───────────────────────────────────────────────────────────── */

const PACKAGE_COLUMNS = `id, name, description, price_idr::float AS price_idr, credit_idr::float AS credit_idr,
  validity_days, is_active, available_online, branch_ids, sort`;

export async function listPackages(scope: "admin" | "cashier" | "member", branchId: string | null = null) {
  const where = scope === "admin" ? "" : scope === "member" ? "WHERE is_active AND available_online" : "WHERE is_active";
  const { rows } = await getPool().query(
    `SELECT ${PACKAGE_COLUMNS} FROM pos.pos_topup_packages ${where} ORDER BY sort, price_idr, name`
  );
  const packages = rows as TopupPackage[];
  return scope === "cashier" ? packages.filter((p) => packageAvailableAt(p, branchId)) : packages;
}

export async function savePackage(id: string | null, input: PackageInput, actorId: string) {
  const params = [
    input.name, input.description, input.price_idr, input.credit_idr, input.validity_days,
    input.is_active, input.available_online, input.branch_ids?.length ? input.branch_ids : null, input.sort, actorId,
  ];
  const { rows } = id
    ? await getPool().query(
        `UPDATE pos.pos_topup_packages
            SET name=$1, description=$2, price_idr=$3, credit_idr=$4, validity_days=$5, is_active=$6,
                available_online=$7, branch_ids=$8, sort=$9, updated_by=$10, updated_at=now()
          WHERE id=$11 RETURNING ${PACKAGE_COLUMNS}`,
        [...params, id]
      )
    : await getPool().query(
        `INSERT INTO pos.pos_topup_packages
           (name, description, price_idr, credit_idr, validity_days, is_active, available_online, branch_ids,
            sort, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${PACKAGE_COLUMNS}`,
        params
      );
  if (!rows[0]) throw new WalletError("Paket tidak ditemukan", 404);
  return rows[0] as TopupPackage;
}

/** Paket yang dijual saat ini; kasir dicek cabangnya, member hanya paket online. */
export async function getPackageForSale(id: string, channel: { branchId: string | null } | "member") {
  const { rows } = await getPool().query(`SELECT ${PACKAGE_COLUMNS} FROM pos.pos_topup_packages WHERE id = $1`, [id]);
  const pkg = rows[0] as TopupPackage | undefined;
  const available =
    pkg && (channel === "member" ? pkg.is_active && pkg.available_online : packageAvailableAt(pkg, channel.branchId));
  if (!pkg || !available) throw new WalletError("Paket top-up tidak tersedia", 404);
  return pkg;
}

/** Field top-up dari paket: harga dibayar, bonus, dan masa berlaku (ditulis ke metadata). */
export function packageTopupFields(pkg: TopupPackage) {
  return {
    amount: pkg.price_idr,
    bonus: packageBonus(pkg),
    metadata: {
      package_id: pkg.id,
      package_name: pkg.name,
      bonus_idr: packageBonus(pkg),
      validity_days: pkg.validity_days,
    },
  };
}

/** Bonus paket = lot terpisah (topup_bonus) dengan masa berlaku yang sama. */
export async function creditTopupBonus(
  client: PoolClient,
  input: {
    customerId: string;
    topupId: string;
    bonusIdr: number;
    expiresAt: Date | null;
    packageMetadata: Record<string, unknown>;
    arkRate: number;
    companyId: string | null;
    branchId: string | null;
  }
): Promise<{ row: WalletRow; balanceAfter: number }> {
  const customer = await lockCustomer(client, input.customerId);
  const after = roundIdr(customer.balance + input.bonusIdr);
  const row = await insertWalletRow(client, {
    customer_id: input.customerId,
    type: "topup_bonus",
    amount: input.bonusIdr,
    balance_before: customer.balance,
    balance_after: after,
    ark_rate: input.arkRate,
    notes: `Bonus paket ${String(input.packageMetadata.package_name ?? "")}`.trim(),
    metadata: { ...input.packageMetadata, source_topup_id: input.topupId },
    expires_at: input.expiresAt,
    package_id: String(input.packageMetadata.package_id ?? "") || null,
    company_id: input.companyId,
    branch_id: input.branchId,
  });
  await setCustomerBalance(client, input.customerId, after);
  return { row, balanceAfter: after };
}

/* ── QRIS pending ────────────────────────────────────────────────────── */

export const QRIS_MIN_AMOUNT = 1_500;
/** QR tanpa expires_at dari Xendit tetap diberi tenggat tampilan. */
const DISPLAY_TTL_MS = 30 * 60_000;

interface PendingQrisTopup {
  transaction: WalletRow;
  qr_string: string;
  reference_id: string;
  xendit_qr_id: string | null;
  expires_at: string;
  simulated: boolean;
}

/**
 * Buat QRIS dinamis Xendit + baris top-up pending. Webhook / rekonsiliasi
 * mengkreditnya lewat creditPendingTopup. `allowSimulated` (khusus dev lokal)
 * membuat QR palsu bila Xendit belum dikonfigurasi.
 */
export async function createPendingQrisTopup(input: {
  customerId: string;
  amount: number;
  balanceBefore: number;
  arkRate: number;
  companyId: string | null;
  branchId: string | null;
  callbackUrl: (configured: string | null) => string;
  source: "cashier" | "member";
  packageMetadata?: Record<string, unknown> | null;
  allowSimulated?: boolean;
}): Promise<PendingQrisTopup> {
  const referenceId = `topup_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  let xendit: Awaited<ReturnType<typeof loadActiveXenditConfig>> | null = null;
  try {
    xendit = await loadActiveXenditConfig();
  } catch (error) {
    if (!input.allowSimulated) {
      throw new WalletError(
        `Pembayaran QRIS belum tersedia: ${error instanceof Error ? error.message : "gateway belum dikonfigurasi"}`,
        503
      );
    }
  }

  const qr = xendit
    ? await createXenditDynamicQr({
        secretKey: xendit.secretKey,
        referenceId,
        amount: input.amount,
        callbackUrl: input.callbackUrl(xendit.callbackUrl),
        description: `ARK topup ${input.amount}`,
      })
    : null;
  const qrString = qr?.qr_string ?? `DEV-SIMULATED-QRIS-${referenceId}`;
  const expiresAt = qr?.expires_at ?? new Date(Date.now() + DISPLAY_TTL_MS).toISOString();

  const transaction = await insertWalletRow(getPool(), {
    customer_id: input.customerId,
    type: "topup",
    status: "pending",
    amount: input.amount,
    balance_before: input.balanceBefore,
    balance_after: input.balanceBefore,
    ark_rate: input.arkRate,
    payment_method: "qris",
    reference_id: referenceId,
    notes: input.source === "member" ? "Top-up mandiri member, menunggu pembayaran QRIS" : "Waiting for QRIS payment",
    metadata: {
      provider: qr ? "xendit" : "dev_simulated",
      environment: xendit?.environment ?? "local",
      qr_string: qrString,
      expires_at: expiresAt,
      xendit_status: qr?.status ?? null,
      source: input.source,
      simulated: !qr,
      ...(input.packageMetadata ?? {}),
    },
    xendit_transaction_id: qr?.id ?? null,
    package_id: input.packageMetadata ? String(input.packageMetadata.package_id) : null,
    company_id: input.companyId,
    branch_id: input.branchId,
  });

  return {
    transaction,
    qr_string: qrString,
    reference_id: referenceId,
    xendit_qr_id: qr?.id ?? null,
    expires_at: expiresAt,
    simulated: !qr,
  };
}

/** Baris top-up milik member tertentu (untuk polling portal). */
export async function loadMemberTopup(customerId: string, topupId: string): Promise<WalletRow | null> {
  const { rows } = await getPool().query(
    `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions WHERE id = $1 AND customer_id = $2 AND type = 'topup'`,
    [topupId, customerId]
  );
  return (rows[0] as WalletRow | undefined) ?? null;
}
