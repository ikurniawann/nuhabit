/** Top-up mandiri member di portal: paket online atau nominal bebas via QRIS. */
import { getPool } from "@/lib/db";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { isDevBypassActive } from "@/lib/member-portal/dev-bypass";
import { createPgClient } from "@/lib/pg/create-client";
import { loadPosLoyaltySettings } from "@/lib/pos/loyalty-settings";
import { checkFreeAmount, packageBonus } from "./packages";
import { loadWalletSettings, WalletError, type WalletRow } from "./server";
import { createPendingQrisTopup, getPackageForSale, listPackages, packageTopupFields, QRIS_MIN_AMOUNT } from "./topup";

/** Batas QR pending member dalam 30 menit terakhir (cegah spam QR ke Xendit). */
const MAX_OPEN_MEMBER_TOPUPS = 3;

/**
 * Simulasi "sudah bayar" hanya untuk dev lokal: memakai pengaman yang sama
 * persis dengan bypass OTP (NODE_ENV bukan production, MEMBER_OTP_DEV_CODE
 * terisi, DATABASE_URL lokal).
 */
export const canSimulateTopup = isDevBypassActive;

export function memberTopupView(row: WalletRow) {
  const meta = row.metadata ?? {};
  const bonus = Number(meta.bonus_idr) || 0;
  return {
    id: row.id,
    status: row.status,
    amount: row.amount,
    credit_idr: row.amount + bonus,
    package_name: (meta.package_name as string | undefined) ?? null,
    qr_string: row.status === "pending" ? ((meta.qr_string as string | undefined) ?? null) : null,
    expires_at: (meta.expires_at as string | undefined) ?? null,
    simulated: meta.simulated === true,
    // Bonus paket ditulis tepat setelah top-up, jadi saldo akhir = saldo top-up + bonus.
    balance_after: row.balance_after + (row.status === "completed" ? bonus : 0),
    created_at: row.created_at,
  };
}

export async function loadMemberTopupOptions(customerId: string) {
  const pool = getPool();
  const [settings, loyalty, packages, member, pending] = await Promise.all([
    loadWalletSettings(pool),
    loadPosLoyaltySettings(createPgClient()),
    listPackages("member"),
    pool.query(`SELECT COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1`, [customerId]),
    pool.query(
      `SELECT id FROM pos.pos_wallet_transactions
        WHERE customer_id = $1 AND type = 'topup' AND status = 'pending'
          AND metadata->>'source' = 'member' AND (metadata->>'expires_at')::timestamptz > now()
        ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    ),
  ]);
  const min = Math.max(settings.topup_min_amount, QRIS_MIN_AMOUNT);
  return {
    balance: Number(member.rows[0]?.balance ?? 0),
    ark_rate: settings.ark_rate,
    min_amount: min,
    max_amount: settings.topup_max_amount,
    presets: loyalty.topup_presets.filter((v) => v >= min && (settings.topup_max_amount <= 0 || v <= settings.topup_max_amount)),
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price_idr: p.price_idr,
      credit_idr: p.credit_idr,
      bonus_idr: packageBonus(p),
      validity_days: p.validity_days,
    })),
    pending_id: (pending.rows[0]?.id as string | undefined) ?? null,
    can_simulate: canSimulateTopup(),
  };
}

export async function createMemberTopup(input: {
  customerId: string;
  packageId?: string | null;
  amount?: number | null;
  webhookUrl: (configured: string | null) => string;
}) {
  const pool = getPool();
  const { rows: open } = await pool.query(
    `SELECT count(*)::int AS n FROM pos.pos_wallet_transactions
      WHERE customer_id = $1 AND type = 'topup' AND status = 'pending'
        AND metadata->>'source' = 'member' AND created_at > now() - interval '30 minutes'`,
    [input.customerId]
  );
  if ((open[0]?.n ?? 0) >= MAX_OPEN_MEMBER_TOPUPS) {
    throw new WalletError("Terlalu banyak QR yang belum dibayar. Selesaikan atau tunggu 30 menit.", 429);
  }

  const settings = await loadWalletSettings(pool);
  const pkg = input.packageId ? packageTopupFields(await getPackageForSale(input.packageId, "member")) : null;
  const amount = pkg ? pkg.amount : Number(input.amount);
  if (!pkg) {
    const problem = checkFreeAmount(amount, Math.max(settings.topup_min_amount, QRIS_MIN_AMOUNT), settings.topup_max_amount);
    if (problem) throw new WalletError(problem);
  }

  const { rows: member } = await pool.query(
    `SELECT COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1`,
    [input.customerId]
  );
  if (!member[0]) throw new WalletError("Member tidak ditemukan", 404);
  const venue = await getCrmDefaultVenue(createPgClient());

  const pending = await createPendingQrisTopup({
    customerId: input.customerId,
    amount,
    balanceBefore: Number(member[0].balance),
    arkRate: settings.ark_rate,
    companyId: venue.companyId,
    branchId: venue.branchId,
    callbackUrl: input.webhookUrl,
    source: "member",
    packageMetadata: pkg?.metadata ?? null,
    allowSimulated: canSimulateTopup(),
  });
  return memberTopupView(pending.transaction);
}
