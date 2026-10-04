import "server-only";
/**
 * Tagihan Member — akses DB (owner 2026-10-01). Lihat lib/pos/member-bill.ts
 * untuk model deposit & aturan saldo.
 *
 * Konsistensi: cicilan + penutupan order dikerjakan dalam SATU transaksi
 * dengan advisory lock per member, jadi dua kasir yang menagih member yang
 * sama tidak bisa lebih bayar atau menutup order dua kali. Efek samping yang
 * memakai klien lain (jurnal, statistik member, XP, nomor antre) dijalankan
 * setelah commit dan bersifat idempoten / non-blocking seperti alur bayar biasa.
 */

import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { postJournalFromMapping } from "@/lib/accounting/journal-mapping-posting";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";
import { AccountingPostError, postPosSaleAccountingJournals } from "@/lib/pos/accounting-posting";
import { listPosPaymentMethods } from "@/lib/pos/payment-methods-store";
import { ensureQueueNumber } from "@/lib/pos/queue-number";
import { todayWib } from "@/lib/pos/report-dates";
import {
  computeMemberBillBalance,
  isMemberBillHandler,
  isMemberBillMethod,
  MEMBER_BILL_PAYMENT_LABEL,
  MEMBER_BILL_PAYMENT_METHOD,
  memberBillBaseMethod,
  memberDepositEvent,
  validateMemberBillAmount,
  type MemberBillBalance,
} from "@/lib/pos/member-bill";

/** Order member yang masuk tagihan: belum lunas, tidak batal, tanpa split bill. */
const OPEN_ORDER_SQL = `
  o.customer_id = $1
  AND o.payment_status = 'unpaid'
  AND o.status NOT IN ('cancelled', 'voided', 'merged')
  AND NOT EXISTS (
    SELECT 1 FROM pos.pos_order_splits s
    WHERE s.order_id = o.id AND s.status <> 'cancelled'
  )`;

export class MemberBillError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "MemberBillError";
  }
}

export type MemberBillSummary = {
  customer_id: string;
  name: string;
  phone: string | null;
  membership_tier: string | null;
  open_order_count: number;
  oldest_order_at: string | null;
  balance: MemberBillBalance;
};

export async function listMemberBills(search = ""): Promise<MemberBillSummary[]> {
  const term = search.trim();
  const rows = await query<{
    id: string;
    name: string | null;
    phone: string | null;
    membership_tier: string | null;
    open_count: number;
    open_total: number;
    oldest: string | null;
    paid: number;
    settled: number;
  }>(
    `WITH open_orders AS (
       SELECT o.customer_id, count(*)::int AS open_count,
              sum(o.total_amount)::float AS open_total, min(o.ordered_at) AS oldest
       FROM pos.pos_orders o
       WHERE o.customer_id IS NOT NULL
         AND o.payment_status = 'unpaid'
         AND o.status NOT IN ('cancelled', 'voided', 'merged')
         AND NOT EXISTS (
           SELECT 1 FROM pos.pos_order_splits s
           WHERE s.order_id = o.id AND s.status <> 'cancelled'
         )
       GROUP BY o.customer_id
     ),
     paid AS (
       SELECT customer_id, sum(amount)::float AS paid
       FROM pos.pos_member_bill_payments GROUP BY customer_id
     ),
     settled AS (
       SELECT customer_id, sum(orders_total)::float AS settled
       FROM pos.pos_member_bill_settlements GROUP BY customer_id
     )
     SELECT c.id, c.name, c.phone, c.membership_tier,
            COALESCE(oo.open_count, 0) AS open_count,
            COALESCE(oo.open_total, 0) AS open_total,
            oo.oldest,
            COALESCE(p.paid, 0) AS paid,
            COALESCE(st.settled, 0) AS settled
     FROM pos.pos_customers c
     LEFT JOIN open_orders oo ON oo.customer_id = c.id
     LEFT JOIN paid p ON p.customer_id = c.id
     LEFT JOIN settled st ON st.customer_id = c.id
     WHERE (oo.open_count > 0 OR COALESCE(p.paid, 0) <> COALESCE(st.settled, 0))
       AND ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%')
     LIMIT 500`,
    [term]
  );

  return rows
    .map((row) => ({
      customer_id: row.id,
      name: row.name || "Member",
      phone: row.phone,
      membership_tier: row.membership_tier,
      open_order_count: Number(row.open_count) || 0,
      oldest_order_at: row.oldest ? new Date(row.oldest).toISOString() : null,
      balance: computeMemberBillBalance({
        openTotal: Number(row.open_total) || 0,
        paymentsTotal: Number(row.paid) || 0,
        settledTotal: Number(row.settled) || 0,
      }),
    }))
    .sort((a, b) => b.balance.outstanding - a.balance.outstanding || a.name.localeCompare(b.name));
}

type OrderItemRow = {
  order_id: string;
  product_name: string;
  quantity: number;
  total_amount: number;
  variants: unknown;
  modifiers: unknown;
};

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === "object" ? String((entry as { name?: unknown }).name ?? "") : ""))
    .filter(Boolean);
}

export async function getMemberBillDetail(customerId: string) {
  const [customer] = await query<{ id: string; name: string | null; phone: string | null; membership_tier: string | null }>(
    `SELECT id, name, phone, membership_tier FROM pos.pos_customers WHERE id = $1`,
    [customerId]
  );
  if (!customer) throw new MemberBillError("Member tidak ditemukan", 404);

  const [openOrders, settledOrders, payments, sums] = await Promise.all([
    query<{ id: string; order_number: string | null; queue_number: string | null; ordered_at: string; order_type: string | null; status: string; total_amount: number }>(
      `SELECT o.id, o.order_number, o.queue_number, o.ordered_at, o.order_type::text AS order_type,
              o.status::text AS status, o.total_amount::float AS total_amount
       FROM pos.pos_orders o WHERE ${OPEN_ORDER_SQL}
       ORDER BY o.ordered_at ASC`,
      [customerId]
    ),
    query<{ id: string; order_number: string | null; ordered_at: string; total_amount: number; settled_at: string }>(
      `SELECT o.id, o.order_number, o.ordered_at, o.total_amount::float AS total_amount, s.created_at AS settled_at
       FROM pos.pos_orders o
       JOIN pos.pos_member_bill_settlements s ON s.id = o.member_bill_settlement_id
       WHERE o.customer_id = $1
       ORDER BY s.created_at DESC, o.ordered_at DESC
       LIMIT 100`,
      [customerId]
    ),
    query<{ id: string; amount: number; payment_method: string; payment_method_name: string | null; reference_number: string | null; notes: string | null; received_by_name: string | null; settlement_id: string | null; created_at: string }>(
      `SELECT id, amount::float AS amount, payment_method, payment_method_name, reference_number, notes,
              received_by_name, settlement_id, created_at
       FROM pos.pos_member_bill_payments WHERE customer_id = $1
       ORDER BY created_at DESC LIMIT 200`,
      [customerId]
    ),
    query<{ paid: number; settled: number }>(
      `SELECT
         (SELECT COALESCE(sum(amount), 0)::float FROM pos.pos_member_bill_payments WHERE customer_id = $1) AS paid,
         (SELECT COALESCE(sum(orders_total), 0)::float FROM pos.pos_member_bill_settlements WHERE customer_id = $1) AS settled`,
      [customerId]
    ),
  ]);

  const items = openOrders.length
    ? await query<OrderItemRow>(
        `SELECT order_id, product_name, quantity::float AS quantity, total_amount::float AS total_amount, variants, modifiers
         FROM pos.pos_order_items WHERE order_id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
        [openOrders.map((order) => order.id)]
      )
    : [];

  const openTotal = openOrders.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);
  return {
    customer: {
      id: customer.id,
      name: customer.name || "Member",
      phone: customer.phone,
      membership_tier: customer.membership_tier,
    },
    balance: computeMemberBillBalance({
      openTotal,
      paymentsTotal: Number(sums[0]?.paid) || 0,
      settledTotal: Number(sums[0]?.settled) || 0,
    }),
    open_orders: openOrders.map((order) => ({
      ...order,
      ordered_at: new Date(order.ordered_at).toISOString(),
      items: items
        .filter((item) => item.order_id === order.id)
        .map((item) => ({
          name: item.product_name,
          quantity: Number(item.quantity) || 0,
          total_amount: Number(item.total_amount) || 0,
          options: [...namesOf(item.variants), ...namesOf(item.modifiers)],
        })),
    })),
    settled_orders: settledOrders.map((order) => ({
      ...order,
      ordered_at: new Date(order.ordered_at).toISOString(),
      settled_at: new Date(order.settled_at).toISOString(),
    })),
    payments: payments.map((payment) => ({
      ...payment,
      created_at: new Date(payment.created_at).toISOString(),
    })),
  };
}

type OpenOrderLock = {
  id: string;
  total_amount: number;
  checkout_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  queue_number: string | null;
};

type SettlementResult = { id: string; orders: OpenOrderLock[] } | null;

async function lockMemberBill(client: PoolClient, customerId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('pos-member-bill:' || $1))`, [customerId]);
  const customer = await client.query<{ id: string; name: string | null }>(
    `SELECT id, name FROM pos.pos_customers WHERE id = $1`,
    [customerId]
  );
  if (!customer.rows[0]) throw new MemberBillError("Member tidak ditemukan", 404);

  const orders = await client.query<OpenOrderLock>(
    `SELECT o.id, o.total_amount::float AS total_amount, o.checkout_id, o.company_id, o.branch_id, o.queue_number
     FROM pos.pos_orders o WHERE ${OPEN_ORDER_SQL}
     ORDER BY o.ordered_at ASC
     FOR UPDATE`,
    [customerId]
  );
  const sums = await client.query<{ paid: number; settled: number }>(
    `SELECT
       (SELECT COALESCE(sum(amount), 0)::float FROM pos.pos_member_bill_payments WHERE customer_id = $1) AS paid,
       (SELECT COALESCE(sum(orders_total), 0)::float FROM pos.pos_member_bill_settlements WHERE customer_id = $1) AS settled`,
    [customerId]
  );
  const openTotal = orders.rows.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);
  return {
    name: customer.rows[0].name || "Member",
    orders: orders.rows,
    paid: Number(sums.rows[0]?.paid) || 0,
    settled: Number(sums.rows[0]?.settled) || 0,
    openTotal,
  };
}

/** Tutup semua order terbuka dari saldo cicilan (dalam transaksi yang sama). */
async function settleOpenOrders(
  client: PoolClient,
  customerId: string,
  orders: OpenOrderLock[],
  openTotal: number,
  user: { id: string; name: string }
): Promise<SettlementResult> {
  if (orders.length === 0) return null;
  const first = orders[0];
  const settlement = await client.query<{ id: string }>(
    `INSERT INTO pos.pos_member_bill_settlements
       (customer_id, orders_total, order_count, settled_by, settled_by_name, company_id, branch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [customerId, openTotal, orders.length, user.id, user.name, first.company_id, first.branch_id]
  );
  const settlementId = settlement.rows[0].id;
  const ids = orders.map((order) => order.id);

  await client.query(
    `UPDATE pos.pos_orders
     SET payment_status = 'paid',
         payment_method = $2,
         payment_method_code = $2,
         payment_method_name = $3,
         amount_paid = total_amount,
         change_amount = 0,
         member_bill_settlement_id = $4,
         updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [ids, MEMBER_BILL_PAYMENT_METHOD, MEMBER_BILL_PAYMENT_LABEL, settlementId]
  );
  await client.query(
    `UPDATE pos.pos_member_bill_payments SET settlement_id = $2
     WHERE customer_id = $1 AND settlement_id IS NULL`,
    [customerId, settlementId]
  );

  // Checkout multi-stall: ikut lunas bila seluruh order anaknya sudah lunas.
  const checkoutIds = [...new Set(orders.map((order) => order.checkout_id).filter(Boolean))] as string[];
  if (checkoutIds.length) {
    await client.query(
      `UPDATE pos.pos_checkouts c
       SET payment_status = 'paid', payment_method = $2, payment_method_code = $2,
           payment_method_name = $3, amount_paid = c.total_amount, change_amount = 0, updated_at = now()
       WHERE c.id = ANY($1::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM pos.pos_orders o
           WHERE o.checkout_id = c.id AND o.payment_status <> 'paid'
             AND o.status NOT IN ('cancelled', 'voided', 'merged')
         )`,
      [checkoutIds, MEMBER_BILL_PAYMENT_METHOD, MEMBER_BILL_PAYMENT_LABEL]
    );
  }

  return { id: settlementId, orders };
}

/** Efek "order lunas" yang sama dengan alur bayar biasa (PUT /api/pos/orders/[id]). */
async function runSettlementSideEffects(customerId: string, settlement: SettlementResult, userId: string) {
  if (!settlement) return [] as string[];
  const db = createPgClient();
  const notes: string[] = [];
  for (const order of settlement.orders) {
    try {
      await ensureQueueNumber(db, order);
    } catch (error) {
      console.error("[member-bill] nomor antre:", order.id, error);
    }
    try {
      const accounting = await postPosSaleAccountingJournals({
        db,
        orderId: order.id,
        userId,
        paymentMethod: MEMBER_BILL_PAYMENT_METHOD,
      });
      if (accounting.note) notes.push(accounting.note);
    } catch (error) {
      // Order sudah lunas (commit) — jurnal gagal dicatat sebagai catatan,
      // bisa di-posting ulang dari modul Accounting.
      const message = error instanceof AccountingPostError ? error.message : String(error);
      console.error("[member-bill] jurnal penjualan:", order.id, message);
      notes.push(`jurnal penjualan gagal: ${message}`);
    }
    await syncPosCustomerOrderStats(db, customerId, Number(order.total_amount) || 0);
    try {
      const { data: items } = await db
        .from("pos_order_items")
        .select("product_id, quantity, unit_price, subtotal, total_amount")
        .eq("order_id", order.id);
      await awardCrmXpForPosOrder(db, {
        orderId: order.id,
        customerId,
        totalAmount: Number(order.total_amount) || 0,
        items: items || [],
        outletId: order.branch_id,
        paymentMethod: MEMBER_BILL_PAYMENT_METHOD,
      });
    } catch (error) {
      console.error("[member-bill] XP:", order.id, error);
    }
  }
  return [...new Set(notes)];
}

export type RecordPaymentInput = {
  customerId: string;
  amount: number;
  paymentMethodCode: string;
  referenceNumber?: string | null;
  notes?: string | null;
  shiftId?: string | null;
  user: { id: string; name: string };
};

export async function recordMemberBillPayment(input: RecordPaymentInput) {
  const methods = await listPosPaymentMethods({ activeOnly: true });
  const method = methods.find((entry) => entry.code === input.paymentMethodCode);
  if (!method) throw new MemberBillError("Metode bayar tidak ditemukan atau tidak aktif");
  if (!isMemberBillMethod(method) || !isMemberBillHandler(method.handler)) {
    throw new MemberBillError(`${method.name} tidak bisa dipakai untuk tagihan member`);
  }
  const baseMethod = memberBillBaseMethod(method.handler);

  const result = await withTransaction(async (client) => {
    const state = await lockMemberBill(client, input.customerId);
    const before = computeMemberBillBalance({
      openTotal: state.openTotal,
      paymentsTotal: state.paid,
      settledTotal: state.settled,
    });
    const invalid = validateMemberBillAmount(input.amount, before.outstanding);
    if (invalid) throw new MemberBillError(invalid);

    const shift = input.shiftId
      ? await client.query<{ id: string }>(
          `SELECT id FROM pos.pos_shifts WHERE id = $1 AND status = 'active'`,
          [input.shiftId]
        )
      : null;
    const first = state.orders[0];
    const payment = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO pos.pos_member_bill_payments
         (customer_id, amount, payment_method, payment_method_code, payment_method_name,
          reference_number, notes, shift_id, received_by, received_by_name, company_id, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, created_at`,
      [
        input.customerId,
        input.amount,
        baseMethod,
        method.code,
        method.name,
        input.referenceNumber?.trim().slice(0, 80) || null,
        input.notes?.trim().slice(0, 300) || null,
        shift?.rows[0]?.id ?? null,
        input.user.id,
        input.user.name,
        first?.company_id ?? null,
        first?.branch_id ?? null,
      ]
    );

    const after = computeMemberBillBalance({
      openTotal: state.openTotal,
      paymentsTotal: state.paid + input.amount,
      settledTotal: state.settled,
    });
    const settlement = after.canSettle
      ? await settleOpenOrders(client, input.customerId, state.orders, state.openTotal, input.user)
      : null;

    return {
      paymentId: payment.rows[0].id,
      customerName: state.name,
      companyId: first?.company_id ?? null,
      settlement,
      balance: settlement
        ? computeMemberBillBalance({
            openTotal: 0,
            paymentsTotal: state.paid + input.amount,
            settledTotal: state.settled + state.openTotal,
          })
        : after,
    };
  });

  const notes: string[] = [];
  const depositEvent = memberDepositEvent(baseMethod);
  if (depositEvent) {
    try {
      const posted = await postJournalFromMapping({
        companyId: result.companyId,
        userId: input.user.id,
        eventCode: depositEvent,
        documentType: "pos_member_bill_payment",
        documentId: result.paymentId,
        entryDate: todayWib(),
        amounts: { TOTAL: input.amount },
        description: `Cicilan tagihan member ${result.customerName} (${method.name})`,
        sourceModule: "POS",
      });
      if (posted.status !== "posted" && posted.reason && posted.reason !== "already_exists") {
        notes.push(`jurnal cicilan ${posted.status}: ${posted.reason}`);
      }
    } catch (error) {
      console.error("[member-bill] jurnal cicilan:", result.paymentId, error);
      notes.push("jurnal cicilan gagal dicatat");
    }
  }
  notes.push(...(await runSettlementSideEffects(input.customerId, result.settlement, input.user.id)));

  return {
    payment_id: result.paymentId,
    balance: result.balance,
    settled_order_count: result.settlement?.orders.length ?? 0,
    notes: [...new Set(notes)],
  };
}

/**
 * Tutup tagihan tanpa cicilan baru — saldo cicilan sudah menutup semua order
 * terbuka (mis. ada order yang di-void setelah dicicil).
 */
export async function settleMemberBillFromCredit(customerId: string, user: { id: string; name: string }) {
  const result = await withTransaction(async (client) => {
    const state = await lockMemberBill(client, customerId);
    const balance = computeMemberBillBalance({
      openTotal: state.openTotal,
      paymentsTotal: state.paid,
      settledTotal: state.settled,
    });
    if (!balance.canSettle) throw new MemberBillError("Saldo cicilan belum menutup semua order");
    return settleOpenOrders(client, customerId, state.orders, state.openTotal, user);
  });
  const notes = await runSettlementSideEffects(customerId, result, user.id);
  return { settled_order_count: result?.orders.length ?? 0, notes };
}
