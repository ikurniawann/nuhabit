import "server-only";
/** Kredit member untuk staf: cari member + saldo, profil kredit, dan jual paket di front desk. */
import { ApiError } from "@/lib/api/auth";
import { getPool, withTransaction } from "@/lib/db";
import {
  createCreditPurchase,
  listCreditPurchases,
  markCreditPurchasePaid,
  payCreditPurchaseWithArk,
  type PurchasePaymentMethod,
} from "./credit-purchases-server";
import { getCreditBalance, loadCreditWallet } from "./credits-server";

const BALANCE_SQL = `(SELECT COALESCE(sum(l.amount), 0)::int FROM gym.credit_ledger l WHERE l.customer_id = c.id)`;

/**
 * Cari member (nama/telepon/email) beserta saldo kredit. Kata kunci < 2 huruf:
 * 20 member dengan aktivitas kredit terbaru.
 */
export async function searchCreditMembers(q: string) {
  const { rows } =
    q.length >= 2
      ? await getPool().query(
          `SELECT c.id, c.name, c.phone, c.email, COALESCE(c.is_active, true) AS is_active, ${BALANCE_SQL} AS balance
             FROM pos.pos_customers c
            WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.email ILIKE $1
            ORDER BY c.name NULLS LAST LIMIT 20`,
          [`%${q}%`]
        )
      : await getPool().query(
          `SELECT c.id, c.name, c.phone, c.email, COALESCE(c.is_active, true) AS is_active, ${BALANCE_SQL} AS balance
             FROM pos.pos_customers c
             JOIN (SELECT customer_id, max(created_at) AS last_at FROM gym.credit_ledger GROUP BY customer_id) a
               ON a.customer_id = c.id
            ORDER BY a.last_at DESC LIMIT 20`
        );
  return rows;
}

/** Cari member (nama/telepon) untuk didaftarkan ke kelas, dengan saldo kredit efektif. */
export async function searchBookableMembers(q: string) {
  if (q.length < 2) return [];
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, phone, is_active FROM pos.pos_customers
      WHERE name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%'
      ORDER BY name LIMIT 10`,
    [q]
  );
  return Promise.all(rows.map(async (row) => ({ ...row, credits: await getCreditBalance(pool, row.id) })));
}

/** Profil singkat, saldo, lot, kredit segera kedaluwarsa, buku besar, dan pembelian member. */
export async function loadMemberCredits(customerId: string) {
  const { rows } = await getPool().query(
    `SELECT id, name, phone, email, COALESCE(is_active, true) AS is_active, membership_tier,
            COALESCE(ark_coin_balance, 0)::float AS ark_balance_idr
       FROM pos.pos_customers WHERE id = $1`,
    [customerId]
  );
  if (!rows[0]) throw ApiError.notFound("Member tidak ditemukan");
  const wallet = await withTransaction((client) => loadCreditWallet(client, customerId, 200));
  const purchases = await listCreditPurchases(getPool(), customerId);
  return { member: rows[0], ...wallet, purchases };
}

export interface FrontDeskSale {
  customerId: string;
  packageId: string;
  paymentMethod: PurchasePaymentMethod;
  discountIdr: number;
  branchId: string | null;
  note?: string | null;
  cashierId: string;
}

/**
 * Jual paket di front desk. Uang diterima di kasir (atau dipotong dari saldo
 * ARK Coin), jadi pembelian langsung lunas dan kredit langsung terbit.
 */
export async function sellCreditPackage(sale: FrontDeskSale) {
  const result = await withTransaction(async (client) => {
    const purchase = await createCreditPurchase(client, {
      customerId: sale.customerId,
      packageId: sale.packageId,
      channel: "front_desk",
      paymentMethod: sale.paymentMethod,
      // Komplimen = diskon penuh (dibatasi harga paket oleh purchaseTotal).
      discountIdr: sale.paymentMethod === "complimentary" ? Number.MAX_SAFE_INTEGER : sale.discountIdr,
      branchId: sale.branchId,
      note: sale.note,
      createdBy: sale.cashierId,
    });
    return sale.paymentMethod === "ark_coin"
      ? payCreditPurchaseWithArk(client, purchase, sale.cashierId)
      : markCreditPurchasePaid(client, purchase.id, { provider: "front_desk", cashier_id: sale.cashierId });
  });
  return result.purchase;
}
