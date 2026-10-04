// Checkout gabungan baru (kasir pusat): rencana → klaim stok → transaksi
// checkout + anak-order → potong ARK → finalisasi.
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import {
  claimMerchandiseStock,
  restoreMerchandiseStock,
  type MerchStockClaim,
} from "@/lib/pos/merchandise-stock";
import { loadPosProductCostMap } from "@/lib/pos/purchasing-sync";
import { resolvePaidMixedOnOccupiedTable, resolveTableSaleTarget } from "@/lib/pos/table-sale-target";
import { appendItemsToExistingCheckout, insertChildrenForCheckout } from "./children";
import { finalizePaidChildren, loadMemberTotalXp } from "./finalize";
import { planMixedSale, type MixedSalePlan } from "./rules";
import {
  findUnpaidCheckout,
  generateQueueNumber,
  insertCheckout,
  nextCheckoutNumber,
  stampPaymentCatalog,
} from "./rows";
import {
  MULTI_STALL_REQUIRED_MESSAGE,
  MixedCheckoutError,
  type CheckoutRow,
  type CostMap,
  type CreateMixedCheckoutInput,
  type MixedCheckoutResult,
} from "./types";

type PgClient = ReturnType<typeof createPgClient>;
type Venue = { companyId: string | null; branchId: string | null };
type PreparedStock = { merchClaimedIds: Set<string>; costMap: CostMap };

/**
 * Cari open bill yang dilanjutkan (id eksplisit atau meja) dan putuskan:
 * tambahkan ke checkout itu, atau buat checkout baru. Melempar bila tidak boleh.
 */
async function resolveExistingCheckout(
  client: PoolClient,
  input: CreateMixedCheckoutInput,
  plan: MixedSalePlan,
  venue: Venue
): Promise<CheckoutRow | null> {
  const explicitCheckoutId = String(input.existingCheckoutId || "").trim();
  let existing: CheckoutRow | null = null;
  if (explicitCheckoutId) {
    existing = await findUnpaidCheckout(client, { checkoutId: explicitCheckoutId }, venue);
    if (!existing) {
      throw new MixedCheckoutError("Open bill tidak ditemukan");
    }
  } else if (input.tableId) {
    existing = await findUnpaidCheckout(client, { tableId: input.tableId }, venue);
  }
  if (!input.tableId && !existing) {
    if (!plan.canCreateFreshCheckout) throw new MixedCheckoutError(MULTI_STALL_REQUIRED_MESSAGE);
    return null;
  }

  if (!plan.requestedUnpaid) {
    const paidTarget = resolvePaidMixedOnOccupiedTable({
      unpaidCentralCheckoutId: existing?.id ?? null,
    });
    if (paidTarget.action === "reject") {
      throw new MixedCheckoutError(paidTarget.message);
    }
  }
  const target = resolveTableSaleTarget({
    saleKind: plan.canCreateFreshCheckout ? "central_mixed" : "central_single",
    unpaidCentralCheckoutId: existing?.id ?? null,
  });
  if (target.action === "append_checkout" && existing && plan.requestedUnpaid) {
    return existing;
  }
  if (!plan.canCreateFreshCheckout) {
    throw new MixedCheckoutError(MULTI_STALL_REQUIRED_MESSAGE);
  }
  return null;
}

async function insertFreshCheckout(
  client: PoolClient,
  input: CreateMixedCheckoutInput,
  plan: MixedSalePlan,
  venue: Venue,
  stock: PreparedStock
): Promise<MixedCheckoutResult> {
  const checkoutNumber = await nextCheckoutNumber(client);
  const queueNumber = await generateQueueNumber(client, venue.companyId, venue.branchId);
  const checkout = await insertCheckout(client, {
    checkoutNumber,
    queueNumber,
    companyId: venue.companyId,
    branchId: venue.branchId,
    tableId: input.tableId || null,
    customerId: input.customerId || null,
    cashierId: input.cashierId,
    shiftId: input.shiftId || null,
    paymentMethod: plan.paymentMethod,
    paymentStatus: plan.paymentStatus,
    subtotal: plan.serverSubtotal,
    discountAmount: plan.discountAmount,
    taxAmount: plan.taxAmount,
    serviceChargeAmount: plan.serviceChargeAmount,
    otherChargesAmount: plan.otherChargesAmount,
    totalAmount: plan.serverTotal,
    amountPaid: plan.amountPaid,
    changeAmount: plan.changeAmount,
    notes: input.notes || null,
    snapshot: plan.snapshot,
  });

  const orderIds = plan.insertChildren
    ? await insertChildrenForCheckout(client, {
        checkout: {
          id: checkout.id,
          queue_number: checkout.queue_number,
          payment_status: plan.paymentStatus,
          payment_method: plan.paymentMethod,
          company_id: venue.companyId,
          branch_id: venue.branchId,
          table_id: input.tableId || null,
          customer_id: input.customerId || null,
          cashier_id: input.cashierId,
          shift_id: input.shiftId || null,
          discount_amount: plan.discountAmount,
          tax_amount: plan.taxAmount,
          service_charge_amount: plan.serviceChargeAmount,
          other_charges_amount: plan.otherChargesAmount,
          amount_paid: plan.amountPaid,
          change_amount: plan.changeAmount,
        },
        snapshot: plan.snapshot,
        isOpenBill: plan.requestedUnpaid,
        warehouseByProduct: input.warehouseByProduct,
        merchClaimedIds: stock.merchClaimedIds,
        costMap: stock.costMap,
        compType: input.compType ?? null,
        compApproved: input.compApproved ?? null,
      })
    : [];

  await stampPaymentCatalog(client, {
    checkoutId: checkout.id,
    orderIds,
    code: input.paymentMethodCode,
    name: input.paymentMethodName,
  });

  return {
    checkoutId: checkout.id,
    checkoutNumber: checkout.checkout_number,
    queueNumber: checkout.queue_number || queueNumber,
    orderIds,
  };
}

/** Satu transaksi: kunci open bill lama, lalu tambahkan item atau buat checkout baru. */
function persistCheckout(
  input: CreateMixedCheckoutInput,
  plan: MixedSalePlan,
  venue: Venue,
  stock: PreparedStock
): Promise<MixedCheckoutResult> {
  return withTransaction(async (client) => {
    const existing = await resolveExistingCheckout(client, input, plan, venue);
    if (existing) {
      return appendItemsToExistingCheckout(client, {
        existing,
        lines: plan.lines,
        snapshot: plan.snapshot,
        merchClaimedIds: stock.merchClaimedIds,
        costMap: stock.costMap,
        discountAmount: plan.discountAmount,
        taxAmount: plan.taxAmount,
        serviceChargeAmount: plan.serviceChargeAmount,
        otherChargesAmount: plan.otherChargesAmount,
        serverSubtotal: plan.serverSubtotal,
        serverTotal: plan.serverTotal,
        paymentStatus: plan.paymentStatus,
      });
    }
    return insertFreshCheckout(client, input, plan, venue, stock);
  });
}

/** Kompensasi bila potong ARK gagal: hapus checkout & anak yang baru dibuat. */
async function deleteCreatedCheckout(created: MixedCheckoutResult) {
  await withTransaction(async (client) => {
    if (created.orderIds.length > 0) {
      await client.query(
        `DELETE FROM pos.pos_print_jobs WHERE order_id = ANY($1::uuid[])`,
        [created.orderIds]
      ).catch(() => {});
      await client.query(
        `DELETE FROM pos.pos_order_status_history WHERE order_id = ANY($1::uuid[])`,
        [created.orderIds]
      );
      await client.query(
        `DELETE FROM pos.pos_order_items WHERE order_id = ANY($1::uuid[])`,
        [created.orderIds]
      );
      await client.query(`DELETE FROM pos.pos_orders WHERE checkout_id = $1`, [
        created.checkoutId,
      ]);
    }
    await client.query(`DELETE FROM pos.pos_checkouts WHERE id = $1`, [created.checkoutId]);
  }).catch((cleanupErr) =>
    console.error("[pos] mixed checkout ARK compensation failed:", cleanupErr)
  );
}

/**
 * Potong saldo ARK lewat RPC (di luar transaksi checkout). Gagal → checkout
 * dikompensasi lalu galat dilempar. Mengembalikan saldo SETELAH potong
 * (EPIC-041: baris "Sisa saldo" di struk).
 */
async function chargeArkCoins(
  db: PgClient,
  input: { customerId: string; arkUsed: number; created: MixedCheckoutResult }
): Promise<number | null> {
  const { data: coinBalance, error: coinError } = await db.rpc("update_ark_coin_balance", {
    p_customer_id: input.customerId,
    p_amount: -input.arkUsed,
    p_type: "payment",
    p_order_id: input.created.orderIds[0],
  });
  if (coinError) {
    await deleteCreatedCheckout(input.created);
    throw new MixedCheckoutError(
      coinError.message?.includes("Insufficient")
        ? "Saldo ARK Coin tidak cukup"
        : "Gagal memproses ARK Coin"
    );
  }
  const balance = Number(coinBalance);
  return Number.isFinite(balance) ? balance : null;
}

export async function createMixedCheckout(
  input: CreateMixedCheckoutInput
): Promise<MixedCheckoutResult> {
  const plan = planMixedSale(input);

  const db = createPgClient();
  const defaultVenue = await getCrmDefaultVenue(db);
  const venue: Venue = {
    companyId: input.companyId || defaultVenue.companyId,
    branchId: input.branchId || defaultVenue.branchId,
  };

  let merchClaims: MerchStockClaim[] = [];
  if (plan.isPaidSale) {
    const merchClaimResult = await claimMerchandiseStock(db, input.items);
    if (!merchClaimResult.ok) {
      throw new MixedCheckoutError(merchClaimResult.reason, merchClaimResult.status);
    }
    merchClaims = merchClaimResult.claims;
  }
  const stock: PreparedStock = {
    merchClaimedIds: new Set(merchClaims.map((claim) => claim.productId)),
    costMap: plan.insertChildren
      ? await loadPosProductCostMap(
          db,
          input.items.map((item) => String(item.product_id || "")).filter(Boolean)
        )
      : new Map(),
  };

  try {
    const created = await persistCheckout(input, plan, venue, stock);

    let arkBalanceAfter: number | null = null;
    if (plan.paymentMethod === "ark_coin" && input.customerId && created.orderIds[0]) {
      arkBalanceAfter = await chargeArkCoins(db, {
        customerId: input.customerId,
        arkUsed: plan.arkUsed,
        created,
      });
    }

    merchClaims = [];

    let xpAwarded = 0;
    let xpTotalAfter: number | null = null;
    if (plan.isPaidSale && plan.insertChildren) {
      const finalized = await finalizePaidChildren({
        orderIds: created.orderIds,
        customerId: input.customerId,
        sessionUserId: input.sessionUserId,
        paymentMethod: plan.paymentMethod,
        branchId: venue.branchId,
      });
      xpAwarded = finalized.xpAwarded;
      if (input.customerId && xpAwarded > 0) {
        xpTotalAfter = await loadMemberTotalXp(db, input.customerId);
      }
    }

    return { ...created, arkBalanceAfter, xpAwarded, xpTotalAfter };
  } catch (error) {
    if (merchClaims.length > 0) {
      await restoreMerchandiseStock(db, merchClaims).catch((restoreErr) =>
        console.error("[pos] mixed checkout merch restore failed:", restoreErr)
      );
    }
    throw error;
  }
}
