import "server-only";
/**
 * Siklus pembelian paket kredit: pending → paid → refunded (port wallet
 * service NüHabit). Pembayaran = uang, buku besar = kredit: pembelian yang
 * lunas MENGHASILKAN entri top_up + lotnya, tidak pernah mengubah saldo sendiri.
 */
import type { PoolClient } from "pg";
import { insertWalletRow, loadWalletSettings, lockCustomer, setCustomerBalance, WalletError } from "@/lib/wallet/server";
import {
  checkPackagePurchase,
  lotExpiry,
  PURCHASE_PROBLEM_MESSAGES,
  purchaseTotal,
} from "./credits";
import { GymCreditError, grantCredits, reverseCreditEntry, type Db } from "./credits-server";

export type PurchaseChannel = "member_portal" | "front_desk";
export const FRONT_DESK_METHODS = ["cash", "card", "transfer", "qris", "ark_coin", "complimentary"] as const;
export type PurchasePaymentMethod = (typeof FRONT_DESK_METHODS)[number];

export interface CreditPurchaseRow {
  id: string;
  customer_id: string;
  package_id: string;
  package_name: string;
  credits: number;
  price_idr: number;
  discount_idr: number;
  total_idr: number;
  channel: PurchaseChannel;
  payment_method: PurchasePaymentMethod | null;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  external_id: string | null;
  payment_meta: Record<string, unknown>;
  branch_id: string | null;
  note: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  created_by: string | null;
  created_at: string;
}

const PURCHASE_SELECT = `SELECT p.id, p.customer_id, p.package_id, pk.name AS package_name, p.credits,
       p.price_idr::float AS price_idr, p.discount_idr::float AS discount_idr, p.total_idr::float AS total_idr,
       p.channel, p.payment_method, p.status, p.external_id, p.payment_meta, p.branch_id, p.note,
       p.paid_at, p.refunded_at, p.created_by, p.created_at
  FROM gym.credit_purchases p JOIN gym.credit_packages pk ON pk.id = p.package_id`;

const topUpKey = (purchaseId: string) => `gym-purchase:${purchaseId}`;

export async function loadCreditPurchase(client: Db, purchaseId: string, lock = false): Promise<CreditPurchaseRow | null> {
  if (lock) await client.query(`SELECT 1 FROM gym.credit_purchases WHERE id = $1 FOR UPDATE`, [purchaseId]);
  const { rows } = await client.query(`${PURCHASE_SELECT} WHERE p.id = $1`, [purchaseId]);
  return (rows[0] as CreditPurchaseRow | undefined) ?? null;
}

export async function listCreditPurchases(client: Db, customerId: string, limit = 50): Promise<CreditPurchaseRow[]> {
  const { rows } = await client.query(`${PURCHASE_SELECT} WHERE p.customer_id = $1 ORDER BY p.created_at DESC LIMIT $2`, [
    customerId,
    limit,
  ]);
  return rows as CreditPurchaseRow[];
}

/**
 * Pembelian yang dihitung untuk batas per member: lunas, atau masih menunggu
 * bayar dalam satu jam terakhir (QR yang ditinggal tidak mengunci member selamanya).
 */
export async function countLivePurchases(client: Db, customerId: string): Promise<Map<string, number>> {
  const { rows } = await client.query(
    `SELECT package_id, count(*)::int AS n FROM gym.credit_purchases
      WHERE customer_id = $1
        AND (status = 'paid' OR (status = 'pending' AND created_at > now() - interval '1 hour'))
      GROUP BY package_id`,
    [customerId]
  );
  return new Map(rows.map((r) => [r.package_id as string, r.n as number]));
}

/** Catat pembelian pending setelah lolos aturan kelayakan paket. */
export async function createCreditPurchase(
  client: PoolClient,
  input: {
    customerId: string;
    packageId: string;
    channel: PurchaseChannel;
    paymentMethod: PurchasePaymentMethod;
    discountIdr?: number;
    branchId?: string | null;
    note?: string | null;
    createdBy?: string | null;
  }
): Promise<CreditPurchaseRow> {
  const [{ rows: pkgRows }, { rows: memberRows }] = await Promise.all([
    client.query(
      `SELECT id, status, credits, price_idr::float AS price_idr, purchase_limit_per_member, branch_id
         FROM gym.credit_packages WHERE id = $1`,
      [input.packageId]
    ),
    client.query(`SELECT id, COALESCE(is_active, true) AS is_active FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, [
      input.customerId,
    ]),
  ]);
  const pkg = pkgRows[0];
  if (!pkg) throw new GymCreditError("Paket tidak ditemukan", 404);
  if (!memberRows[0]) throw new GymCreditError("Member tidak ditemukan", 404);
  const counts = await countLivePurchases(client, input.customerId);
  const problem = checkPackagePurchase({
    pkg: {
      id: pkg.id,
      status: pkg.status,
      purchaseLimitPerMember: pkg.purchase_limit_per_member,
      branchId: pkg.branch_id,
    },
    purchaseCount: counts.get(pkg.id) ?? 0,
    memberActive: memberRows[0].is_active,
    branchId: input.branchId ?? null,
  });
  if (problem) throw new GymCreditError(PURCHASE_PROBLEM_MESSAGES[problem], 409);

  const { discountIdr, totalIdr } = purchaseTotal(pkg.price_idr, input.discountIdr);
  const { rows } = await client.query(
    `INSERT INTO gym.credit_purchases
       (customer_id, package_id, credits, price_idr, discount_idr, total_idr, channel, payment_method, branch_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      input.customerId,
      pkg.id,
      pkg.credits,
      pkg.price_idr,
      discountIdr,
      totalIdr,
      input.channel,
      input.paymentMethod,
      input.branchId ?? null,
      input.note?.trim() || null,
      input.createdBy ?? null,
    ]
  );
  return (await loadCreditPurchase(client, rows[0].id))!;
}

/**
 * Tandai lunas dan terbitkan kredit (top_up + lot) dalam transaksi pemanggil.
 * Webhook ganda aman: baris dikunci, panggilan kedua melihat status paid.
 */
export async function markCreditPurchasePaid(
  client: PoolClient,
  purchaseId: string,
  paymentMeta: Record<string, unknown> = {}
): Promise<{ status: "paid" | "already_paid"; purchase: CreditPurchaseRow }> {
  const purchase = await loadCreditPurchase(client, purchaseId, true);
  if (!purchase) throw new GymCreditError("Pembelian tidak ditemukan", 404);
  if (purchase.status === "paid") return { status: "already_paid", purchase };
  // QR yang kami tandai expired masih bisa terbayar di sisi gateway: uang yang
  // benar-benar masuk tetap menerbitkan kredit. Hanya refund yang final.
  if (purchase.status === "refunded") throw new GymCreditError("Pembelian yang sudah direfund tidak bisa dilunasi", 409);

  const { rows } = await client.query(
    `UPDATE gym.credit_purchases
        SET status = 'paid', paid_at = now(), updated_at = now(), payment_meta = payment_meta || $2::jsonb
      WHERE id = $1
      RETURNING paid_at, (SELECT validity_days FROM gym.credit_packages WHERE id = package_id) AS validity_days`,
    [purchaseId, JSON.stringify(paymentMeta)]
  );
  await grantCredits(client, {
    customerId: purchase.customer_id,
    type: "top_up",
    credits: purchase.credits,
    expiresAt: lotExpiry(new Date(rows[0].paid_at), Number(rows[0].validity_days)),
    packageId: purchase.package_id,
    purchaseId,
    sourceType: "purchase",
    sourceId: purchaseId,
    note: purchase.package_name,
    idempotencyKey: topUpKey(purchaseId),
    createdBy: purchase.created_by,
  });
  return { status: "paid", purchase: (await loadCreditPurchase(client, purchaseId))! };
}

/** Pending → failed/expired (QR kedaluwarsa, gateway gagal). Status lain dibiarkan. */
export async function closeCreditPurchase(client: Db, purchaseId: string, status: "failed" | "expired") {
  await client.query(
    `UPDATE gym.credit_purchases SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`,
    [purchaseId, status]
  );
}

/* ── ARK Coin ────────────────────────────────────────────────────────── */

/**
 * Mutasi saldo ARK Coin (rupiah) memakai primitif dompet yang sama dengan
 * koreksi admin: baris member dikunci FOR UPDATE, saldo tidak boleh minus.
 */
export async function moveArkBalance(
  client: PoolClient,
  input: { customerId: string; delta: number; notes: string; purchase: CreditPurchaseRow; actorId?: string | null }
) {
  const customer = await lockCustomer(client, input.customerId).catch((error: unknown) => {
    throw error instanceof WalletError ? new GymCreditError(error.message, error.status) : error;
  });
  const after = customer.balance + input.delta;
  if (after < 0) throw new GymCreditError("Saldo ARK Coin tidak cukup", 409);
  const settings = await loadWalletSettings(client);
  await insertWalletRow(client, {
    customer_id: customer.id,
    type: input.delta < 0 ? "payment" : "refund",
    amount: Math.abs(input.delta),
    balance_before: customer.balance,
    balance_after: after,
    ark_rate: settings.ark_rate,
    notes: input.notes,
    metadata: { source: "gym_credit_purchase", purchase_id: input.purchase.id, actor_id: input.actorId ?? null },
    branch_id: input.purchase.branch_id,
  });
  await setCustomerBalance(client, customer.id, after);
}

/** Bayar pembelian pending dengan saldo ARK Coin lalu terbitkan kreditnya. */
export async function payCreditPurchaseWithArk(client: PoolClient, purchase: CreditPurchaseRow, actorId?: string | null) {
  await moveArkBalance(client, {
    customerId: purchase.customer_id,
    delta: -purchase.total_idr,
    notes: `Beli paket kredit gym: ${purchase.package_name}`,
    purchase,
    actorId,
  });
  return markCreditPurchasePaid(client, purchase.id, { provider: "ark_coin" });
}

/* ── Refund ──────────────────────────────────────────────────────────── */

/**
 * Refund pembelian lunas: status refunded + entri reversal atas top_up-nya.
 * Kredit yang sudah terpakai membuat saldo kurang, dan reversal ditolak.
 * Pembayaran ARK Coin dikembalikan ke saldo ARK; metode lain dikembalikan
 * manual oleh kasir (dicatat di catatan pembelian).
 */
export async function refundCreditPurchase(
  client: PoolClient,
  purchaseId: string,
  input: { reason: string; actorId: string }
): Promise<CreditPurchaseRow> {
  const purchase = await loadCreditPurchase(client, purchaseId, true);
  if (!purchase) throw new GymCreditError("Pembelian tidak ditemukan", 404);
  if (purchase.status !== "paid") throw new GymCreditError("Hanya pembelian lunas yang bisa direfund", 409);
  const { rows } = await client.query(`SELECT id FROM gym.credit_ledger WHERE idempotency_key = $1`, [topUpKey(purchaseId)]);
  if (rows[0]) await reverseCreditEntry(client, { entryId: rows[0].id, reason: input.reason, actorId: input.actorId });
  if (purchase.payment_method === "ark_coin" && purchase.total_idr > 0) {
    await moveArkBalance(client, {
      customerId: purchase.customer_id,
      delta: purchase.total_idr,
      notes: `Refund paket kredit gym: ${purchase.package_name}`,
      purchase,
      actorId: input.actorId,
    });
  }
  await client.query(
    `UPDATE gym.credit_purchases
        SET status = 'refunded', refunded_at = now(), updated_at = now(),
            note = concat_ws(' · ', note, $2::text)
      WHERE id = $1`,
    [purchaseId, `Refund: ${input.reason.trim()}`]
  );
  return (await loadCreditPurchase(client, purchaseId))!;
}
