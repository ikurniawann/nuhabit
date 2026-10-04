// SQL baris-per-baris checkout gabungan. Semua fungsi menerima PoolClient
// dari transaksi pemanggil; tidak ada yang membuka transaksi sendiri.
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { normalizeStation } from "@/lib/pos/kitchen-station";
import { resolvePaymentCatalogStamp } from "@/lib/pos/payment-methods";
import { buildCostSnapshot } from "@/lib/pos/purchasing-sync";
import { toNumber, unpaidCheckoutScopeSql } from "./rules";
import {
  MixedCheckoutError,
  type BuiltLine,
  type CheckoutRow,
  type CostMap,
  type MixedCheckoutCartSnapshot,
} from "./types";

/** Kolom opsional belum dimigrasi di DB lama → jatuh ke query tanpa kolom itu. */
export function isMissingColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42703" ||
    candidate.code === "PGRST204" ||
    /column .* does not exist/i.test(candidate.message ?? "")
  );
}

export async function stampPaymentCatalog(
  client: PoolClient,
  input: {
    checkoutId?: string | null;
    orderIds?: string[];
    code?: string | null;
    name?: string | null;
  }
) {
  const stamp = resolvePaymentCatalogStamp({
    code: input.code,
    name: input.name,
  });
  if (!stamp.payment_method_code && !stamp.payment_method_name) return;
  try {
    if (input.checkoutId) {
      await client.query(
        `UPDATE pos.pos_checkouts
         SET payment_method_code = $2, payment_method_name = $3, updated_at = now()
         WHERE id = $1`,
        [input.checkoutId, stamp.payment_method_code, stamp.payment_method_name]
      );
    }
    if (input.orderIds && input.orderIds.length > 0) {
      await client.query(
        `UPDATE pos.pos_orders
         SET payment_method_code = $2, payment_method_name = $3, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [input.orderIds, stamp.payment_method_code, stamp.payment_method_name]
      );
    }
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
  }
}

export async function nextCheckoutNumber(client: PoolClient): Promise<string> {
  const prefixRes = await client.query<{ prefix: string }>(
    `SELECT 'CHK-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') AS prefix`
  );
  const prefix = prefixRes.rows[0]?.prefix || "CHK-00000000";
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `pos_checkout_number:${prefix}`,
  ]);
  const seqRes = await client.query<{ seq: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(checkout_number FROM LENGTH($1) + 2) AS integer)), 0) + 1 AS seq
     FROM pos.pos_checkouts
     WHERE checkout_number LIKE $1 || '-%'`,
    [prefix]
  );
  const seq = Number(seqRes.rows[0]?.seq) || 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export async function generateOrderNumber(client: PoolClient): Promise<string> {
  const result = await client.query<{ value: string }>(
    "SELECT generate_order_number() AS value"
  );
  return String(result.rows[0]?.value || "");
}

export async function generateQueueNumber(
  client: PoolClient,
  companyId: string | null,
  branchId: string | null
): Promise<string> {
  const result = await client.query<{ value: string }>(
    "SELECT generate_queue_number($1, $2) AS value",
    [companyId, branchId]
  );
  return result.rows[0]?.value != null ? String(result.rows[0].value) : "";
}

const CHECKOUT_BASE_COLUMNS = `id, checkout_number, queue_number, payment_status, payment_method,
              company_id, branch_id, table_id, customer_id, cashier_id, shift_id,
              subtotal, discount_amount, tax_amount, service_charge_amount,
              other_charges_amount, total_amount, amount_paid, change_amount,
              notes`;

/** Kunci baris checkout (FOR UPDATE) beserta snapshot & jejak QRIS. */
export async function loadCheckoutForUpdate(
  client: PoolClient,
  checkoutId: string
): Promise<CheckoutRow | null> {
  try {
    const result = await client.query<CheckoutRow>(
      `SELECT ${CHECKOUT_BASE_COLUMNS}, cart_snapshot, xendit_qr_id, xendit_external_id,
              payment_method_code, payment_method_name
       FROM pos.pos_checkouts
       WHERE id = $1
       FOR UPDATE`,
      [checkoutId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    const result = await client.query<CheckoutRow>(
      `SELECT ${CHECKOUT_BASE_COLUMNS}
       FROM pos.pos_checkouts
       WHERE id = $1
       FOR UPDATE`,
      [checkoutId]
    );
    return result.rows[0] ?? null;
  }
}

type ScopeFilter = { companyId?: string | null; branchId?: string | null };

/** Checkout unpaid & belum dibatalkan (dikunci FOR UPDATE), dicari per meja atau per id. */
export async function findUnpaidCheckout(
  client: PoolClient,
  by: { tableId: string } | { checkoutId: string },
  scope: ScopeFilter = {}
): Promise<CheckoutRow | null> {
  const byTable = "tableId" in by;
  try {
    const scoped = unpaidCheckoutScopeSql({
      companyId: scope.companyId,
      branchId: scope.branchId,
      startParam: 2,
    });
    const result = await client.query<CheckoutRow>(
      `SELECT ${CHECKOUT_BASE_COLUMNS}, cart_snapshot
       FROM pos.pos_checkouts
       WHERE ${byTable ? "table_id" : "id"} = $1
         AND LOWER(payment_status::text) <> 'paid'
         AND COALESCE(notes, '') NOT ILIKE 'cancelled%'
         ${scoped.sql}
       ${byTable ? "ORDER BY created_at DESC\n       LIMIT 1\n       " : ""}FOR UPDATE`,
      [byTable ? by.tableId : by.checkoutId, ...scoped.params]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    return null;
  }
}

export type CheckoutInsertRow = {
  checkoutNumber: string;
  queueNumber: string;
  companyId: string | null;
  branchId: string | null;
  tableId: string | null;
  customerId: string | null;
  cashierId: string;
  shiftId: string | null;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  otherChargesAmount: number;
  totalAmount: number;
  amountPaid: number;
  changeAmount: number;
  notes: string | null;
  snapshot: MixedCheckoutCartSnapshot;
};

type InsertedCheckout = { id: string; checkout_number: string; queue_number: string | null };

export async function insertCheckout(
  client: PoolClient,
  row: CheckoutInsertRow
): Promise<InsertedCheckout> {
  const params = [
    row.checkoutNumber,
    row.queueNumber,
    row.companyId,
    row.branchId,
    row.tableId,
    row.customerId,
    row.cashierId,
    row.shiftId,
    row.paymentMethod,
    row.paymentStatus,
    row.subtotal,
    row.discountAmount,
    row.taxAmount,
    row.serviceChargeAmount,
    row.otherChargesAmount,
    row.totalAmount,
    row.amountPaid,
    row.changeAmount,
    row.notes,
    JSON.stringify(row.snapshot),
  ];
  const insert = async (withSnapshot: boolean) => {
    const result = await client.query<InsertedCheckout>(
      `INSERT INTO pos.pos_checkouts (
         checkout_number, queue_number, company_id, branch_id, table_id, customer_id,
         cashier_id, shift_id, payment_method, payment_status, subtotal, discount_amount,
         tax_amount, service_charge_amount, other_charges_amount, total_amount,
         amount_paid, change_amount, notes${withSnapshot ? ", cart_snapshot" : ""}
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::pos_payment_method,$10::pos_payment_status,
         $11,$12,$13,$14,$15,$16,$17,$18,$19${withSnapshot ? ",$20::jsonb" : ""}
       )
       RETURNING id, checkout_number, queue_number`,
      withSnapshot ? params : params.slice(0, 19)
    );
    const inserted = result.rows[0];
    if (!inserted) throw new MixedCheckoutError("Gagal membuat checkout", 500);
    return inserted;
  };
  try {
    return await insert(true);
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    return insert(false);
  }
}

export type ChildOrderRow = {
  orderNumber: string;
  queueNumber: string;
  orderType: string;
  paymentStatus: string;
  paymentMethod: string;
  companyId: string | null;
  branchId: string | null;
  warehouseId: string;
  checkoutId: string;
  customerId: string | null;
  cashierId: string;
  serverId: string | null;
  tableId: string | null;
  guestCount: number;
  shiftId: string | null;
  subtotal: number;
  discount: number;
  discountReason: string | null;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
  total: number;
  amountPaid: number;
  changeAmount: number;
  notes: string | null;
  specialRequests: string | null;
  orderStatus: "pending" | "completed";
  /** EPIC-043 — 'kol_comp' distempel ke tiap anak-order checkout KOL. */
  compType?: string | null;
  /** Metode FOC — supervisor penyetuju, jejak audit per anak-order. */
  compApprovedBy?: string | null;
  compApprovedName?: string | null;
};

export async function insertChildOrder(client: PoolClient, row: ChildOrderRow): Promise<string> {
  const id = randomUUID();
  const orderStatus = row.orderStatus;
  await client.query(
    `INSERT INTO pos.pos_orders (
       id, order_number, queue_number, order_type, status, payment_status, payment_method,
       company_id, branch_id, warehouse_id, checkout_id, sold_from,
       customer_id, cashier_id, server_id, table_id, guest_count, shift_id,
       subtotal, discount_amount, discount_reason, tax_amount, service_charge_amount,
       other_charges_amount, charges_breakdown, total_amount, amount_paid, change_amount,
       notes, special_requests, ordered_at, completed_at, comp_type,
       comp_approved_by, comp_approved_name
     ) VALUES (
       $1,$2,$3,$4::pos_order_type,$28::pos_order_status,$5::pos_payment_status,$6::pos_payment_method,
       $7,$8,$9,$10,'central',
       $11,$12,$13,$14,$15,$16,
       $17,$18,$19,$20,$21,
       $22,'[]'::jsonb,$23,$24,$25,
       $26,$27, now(), $29, $30,
       $31, $32
     )`,
    [
      id,
      row.orderNumber,
      row.queueNumber,
      row.orderType,
      row.paymentStatus,
      row.paymentMethod,
      row.companyId,
      row.branchId,
      row.warehouseId,
      row.checkoutId,
      row.customerId,
      row.cashierId,
      row.serverId,
      row.tableId,
      row.guestCount,
      row.shiftId,
      row.subtotal,
      row.discount,
      row.discountReason,
      row.tax,
      row.serviceCharge,
      row.otherCharges,
      row.total,
      row.amountPaid,
      row.changeAmount,
      row.notes,
      row.specialRequests,
      orderStatus,
      orderStatus === "completed" ? new Date() : null,
      row.compType ?? null,
      row.compApprovedBy ?? null,
      row.compApprovedName ?? null,
    ]
  );
  return id;
}

export async function insertChildItems(
  client: PoolClient,
  orderId: string,
  lines: BuiltLine[],
  costMap: CostMap,
  merchClaimedIds: Set<string>
) {
  for (const line of lines) {
    const costSnapshot = buildCostSnapshot(
      line.product_id ? costMap.get(line.product_id) : undefined,
      line.qty,
      line.lineTotal
    );
    const discType =
      line.discount_type === "percent" || line.discount_type === "fixed"
        ? line.discount_type
        : null;
    const discValue =
      line.discount_value == null || line.discount_value === ""
        ? null
        : toNumber(line.discount_value);
    const station = normalizeStation(line.station, String(line.product_name || ""), "");
    await client.query(
      `INSERT INTO pos.pos_order_items (
         order_id, product_id, sku_id, product_name, product_sku, variants, modifiers,
         quantity, unit_price, subtotal, discount_type, discount_value, discount_amount,
         total_amount, xp_earned, station, kitchen_status, inventory_deducted,
         cost_price, cost_total, gross_profit, gross_margin_pct
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,
         $8,$9,$10,$11,$12,$13,
         $14,0,$15,'pending',$16,
         $17,$18,$19,$20
       )`,
      [
        orderId,
        line.product_id || null,
        line.sku_id || null,
        line.product_name || "Unknown",
        String(line.product_sku || line.product_id || "").slice(0, 50),
        JSON.stringify(line.variants || []),
        JSON.stringify(line.modifiers || []),
        line.qty,
        line.unitPrice,
        line.lineSubtotal,
        discType,
        discValue,
        line.lineDiscount,
        line.lineTotal,
        station,
        line.product_id ? merchClaimedIds.has(String(line.product_id)) : false,
        costSnapshot.cost_price,
        costSnapshot.cost_total,
        costSnapshot.gross_profit,
        costSnapshot.gross_margin_pct,
      ]
    );
  }
}

export async function insertOrderCreatedHistory(
  client: PoolClient,
  input: { orderId: string; cashierId: string; paid: boolean; orderStatus: string }
) {
  await client.query(
    `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
     VALUES ($1, NULL, $4, $2, $3)`,
    [
      input.orderId,
      input.cashierId,
      input.paid ? "Order created and paid from central checkout" : "Order created from central checkout",
      input.orderStatus,
    ]
  );
}
