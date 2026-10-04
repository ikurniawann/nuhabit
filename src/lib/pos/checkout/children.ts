// Anak-order checkout gabungan: satu pos_orders per stall, di dalam transaksi
// pemanggil.
import type { PoolClient } from "pg";
import { planCheckoutAppend } from "@/lib/pos/table-sale-target";
import {
  allocateCheckoutTender,
  allocateSliceCharges,
  buildLines,
  parseSnapshot,
  resolveCheckoutChildOrderStatus,
  sliceLinesByStall,
  toNumber,
} from "./rules";
import {
  generateOrderNumber,
  insertChildItems,
  insertChildOrder,
  insertOrderCreatedHistory,
  isMissingColumn,
} from "./rows";
import {
  MULTI_STALL_REQUIRED_MESSAGE,
  MixedCheckoutError,
  type BuiltLine,
  type CheckoutRow,
  type CompApprover,
  type CostMap,
  type MixedCheckoutCartSnapshot,
  type MixedCheckoutResult,
} from "./types";

/** Kolom checkout yang dibaca saat memecah checkout ke anak-order. */
export type ChildSourceCheckout = Pick<
  CheckoutRow,
  | "id"
  | "queue_number"
  | "payment_status"
  | "payment_method"
  | "company_id"
  | "branch_id"
  | "table_id"
  | "customer_id"
  | "cashier_id"
  | "shift_id"
  | "discount_amount"
  | "tax_amount"
  | "service_charge_amount"
  | "other_charges_amount"
  | "amount_paid"
  | "change_amount"
>;

/**
 * Buat anak-order per stall dari snapshot: biaya dibagi pro-rata subtotal,
 * tender dibagi pro-rata total, kembalian hanya di anak pertama.
 */
export async function insertChildrenForCheckout(
  client: PoolClient,
  input: {
    checkout: ChildSourceCheckout;
    isOpenBill?: boolean;
    snapshot: MixedCheckoutCartSnapshot;
    warehouseByProduct: Map<string, string | null>;
    merchClaimedIds: Set<string>;
    costMap: CostMap;
    compType?: string | null;
    compApproved?: CompApprover | null;
  }
): Promise<string[]> {
  const slices = sliceLinesByStall(buildLines(input.snapshot.items, input.warehouseByProduct));
  if (slices.length < 2) {
    throw new MixedCheckoutError(MULTI_STALL_REQUIRED_MESSAGE);
  }

  const allocated = allocateSliceCharges(slices, {
    discount: toNumber(input.checkout.discount_amount),
    tax: toNumber(input.checkout.tax_amount),
    serviceCharge: toNumber(input.checkout.service_charge_amount),
    otherCharges: toNumber(input.checkout.other_charges_amount),
  });
  const paidParts = allocateCheckoutTender(
    toNumber(input.checkout.amount_paid),
    allocated.map((row) => row.total)
  );
  const queueNumber = String(input.checkout.queue_number || "");
  const orderStatus = resolveCheckoutChildOrderStatus({
    paymentStatus: input.checkout.payment_status,
    isOpenBill: Boolean(input.isOpenBill),
  });
  const orderIds: string[] = [];

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    const charges = allocated[index];
    if (!slice || !charges) continue;
    const orderNumber = await generateOrderNumber(client);
    const orderId = await insertChildOrder(client, {
      orderNumber,
      queueNumber,
      orderType: input.snapshot.orderType,
      paymentStatus: input.checkout.payment_status,
      paymentMethod: input.checkout.payment_method || "cash",
      companyId: input.checkout.company_id,
      branchId: input.checkout.branch_id,
      warehouseId: slice.warehouseId,
      checkoutId: input.checkout.id,
      customerId: input.checkout.customer_id,
      cashierId: input.checkout.cashier_id,
      serverId: input.snapshot.serverId,
      tableId: input.checkout.table_id,
      guestCount: input.snapshot.guestCount,
      shiftId: input.checkout.shift_id,
      subtotal: slice.subtotal,
      discount: charges.discount,
      discountReason: input.snapshot.discountReason,
      tax: charges.tax,
      serviceCharge: charges.serviceCharge,
      otherCharges: charges.otherCharges,
      total: charges.total,
      amountPaid: paidParts[index] ?? 0,
      changeAmount: index === 0 ? toNumber(input.checkout.change_amount) : 0,
      notes: input.snapshot.notes,
      specialRequests: input.snapshot.specialRequests,
      orderStatus,
      compType: input.compType ?? null,
      compApprovedBy: input.compApproved?.id ?? null,
      compApprovedName: input.compApproved?.name ?? null,
    });
    await insertChildItems(client, orderId, slice.lines, input.costMap, input.merchClaimedIds);
    await insertOrderCreatedHistory(client, {
      orderId,
      cashierId: input.checkout.cashier_id,
      paid: input.checkout.payment_status === "paid",
      orderStatus,
    });
    orderIds.push(orderId);
  }

  return orderIds;
}

/**
 * Open bill meja: tambahkan item ke checkout unpaid yang ada. Stall yang sudah
 * punya anak-order aktif ditambah nominalnya; stall baru dapat anak baru.
 */
export async function appendItemsToExistingCheckout(
  client: PoolClient,
  input: {
    existing: CheckoutRow;
    lines: BuiltLine[];
    snapshot: MixedCheckoutCartSnapshot;
    merchClaimedIds: Set<string>;
    costMap: CostMap;
    discountAmount: number;
    taxAmount: number;
    serviceChargeAmount: number;
    otherChargesAmount: number;
    serverSubtotal: number;
    serverTotal: number;
    paymentStatus: string;
  }
): Promise<MixedCheckoutResult> {
  const slices = sliceLinesByStall(input.lines);
  const allocated = allocateSliceCharges(slices, {
    discount: input.discountAmount,
    tax: input.taxAmount,
    serviceCharge: input.serviceChargeAmount,
    otherCharges: input.otherChargesAmount,
  });

  const children = await client.query<{ id: string; warehouse_id: string | null }>(
    `SELECT id, warehouse_id FROM pos.pos_orders
     WHERE checkout_id = $1
       AND COALESCE(sold_from, 'stall') = 'central'
       AND status::text NOT IN ('completed', 'cancelled', 'voided', 'merged')
       AND LOWER(payment_status::text) <> 'paid'`,
    [input.existing.id]
  );
  const plan = planCheckoutAppend({
    incomingWarehouseIds: slices.map((slice) => slice.warehouseId),
    existingCentralChildren: children.rows,
  });
  const orderIds: string[] = [];

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    const charges = allocated[index];
    const planned = plan.children[index];
    if (!slice || !charges || !planned) continue;
    let orderId = planned.action === "append" ? planned.orderId : null;
    if (!orderId) {
      const orderNumber = await generateOrderNumber(client);
      orderId = await insertChildOrder(client, {
        orderNumber,
        queueNumber: String(input.existing.queue_number || ""),
        orderType: input.snapshot.orderType,
        paymentStatus: input.paymentStatus,
        paymentMethod: input.existing.payment_method || "cash",
        companyId: input.existing.company_id,
        branchId: input.existing.branch_id,
        warehouseId: slice.warehouseId,
        checkoutId: input.existing.id,
        customerId: input.existing.customer_id,
        cashierId: input.existing.cashier_id,
        serverId: input.snapshot.serverId,
        tableId: input.existing.table_id,
        guestCount: input.snapshot.guestCount,
        shiftId: input.existing.shift_id,
        subtotal: slice.subtotal,
        discount: charges.discount,
        discountReason: input.snapshot.discountReason,
        tax: charges.tax,
        serviceCharge: charges.serviceCharge,
        otherCharges: charges.otherCharges,
        total: charges.total,
        amountPaid: 0,
        changeAmount: 0,
        notes: input.snapshot.notes,
        specialRequests: input.snapshot.specialRequests,
        orderStatus: resolveCheckoutChildOrderStatus({
          paymentStatus: input.paymentStatus,
          isOpenBill: true,
        }),
      });
    } else {
      await client.query(
        `UPDATE pos.pos_orders SET
           subtotal = COALESCE(subtotal, 0) + $1,
           discount_amount = COALESCE(discount_amount, 0) + $2,
           tax_amount = COALESCE(tax_amount, 0) + $3,
           service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
           other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
           total_amount = COALESCE(total_amount, 0) + $6,
           updated_at = now()
         WHERE id = $7`,
        [
          slice.subtotal,
          charges.discount,
          charges.tax,
          charges.serviceCharge,
          charges.otherCharges,
          charges.total,
          orderId,
        ]
      );
    }
    await insertChildItems(client, orderId, slice.lines, input.costMap, input.merchClaimedIds);
    orderIds.push(orderId);
  }

  const prevSnapshot = parseSnapshot(input.existing);
  const mergedSnapshot: MixedCheckoutCartSnapshot = {
    ...input.snapshot,
    items: [...(prevSnapshot?.items || []), ...input.snapshot.items],
    warehouseByProduct: {
      ...(prevSnapshot?.warehouseByProduct || {}),
      ...input.snapshot.warehouseByProduct,
    },
  };

  const totals = [
    input.serverSubtotal,
    input.discountAmount,
    input.taxAmount,
    input.serviceChargeAmount,
    input.otherChargesAmount,
    input.serverTotal,
  ];
  const addTotals = `subtotal = COALESCE(subtotal, 0) + $1,
         discount_amount = COALESCE(discount_amount, 0) + $2,
         tax_amount = COALESCE(tax_amount, 0) + $3,
         service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
         other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
         total_amount = COALESCE(total_amount, 0) + $6,`;
  try {
    await client.query(
      `UPDATE pos.pos_checkouts SET
         ${addTotals}
         cart_snapshot = $7::jsonb,
         updated_at = now()
       WHERE id = $8`,
      [...totals, JSON.stringify(mergedSnapshot), input.existing.id]
    );
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    await client.query(
      `UPDATE pos.pos_checkouts SET
         ${addTotals}
         updated_at = now()
       WHERE id = $7`,
      [...totals, input.existing.id]
    );
  }

  return {
    checkoutId: input.existing.id,
    checkoutNumber: input.existing.checkout_number,
    queueNumber: String(input.existing.queue_number || ""),
    orderIds,
  };
}
