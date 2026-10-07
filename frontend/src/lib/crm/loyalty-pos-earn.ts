// XP dari transaksi POS: order, split payment, topup ARK, bonus XP produk.
import type { DbClient } from "@/lib/pg/types";
import { getCrmDefaultVenue, isMissingCrmSchema, toNumber } from "@/lib/crm/server";
import { formatRupiah } from "@/lib/format";
import {
  calculateSpendXp,
  calculateTopupXp,
  loadPosLoyaltySettings,
} from "@/lib/pos/loyalty-settings";
import { computeProductBonusXp } from "@/lib/promo/product-bonus-xp";
import { awardFlatXp, postXpEvent } from "./loyalty-ledger";
import {
  calculateXp,
  findBestRule,
  isXpEligiblePayment,
  itemAmount,
  itemQuantity,
  type CrmXpAwardResult,
  type CrmXpRule,
  type PosOrderItemInput,
} from "./loyalty-rules";
import { syncAfterEarn } from "./loyalty-tier-sync";

type PosOrderXpPayload = {
  orderId: string;
  customerId?: string | null;
  totalAmount: number;
  items: PosOrderItemInput[];
  outletId?: string | null;
  paymentMethod?: string | null;
};

const NO_CUSTOMER: CrmXpAwardResult = { status: "skipped", xpAwarded: 0, reason: "no_customer" };
const NON_ARK: CrmXpAwardResult = { status: "skipped", xpAwarded: 0, reason: "non_ark_payment" };
const SCHEMA_NOT_READY: CrmXpAwardResult = { status: "skipped", xpAwarded: 0, reason: "crm_schema_not_ready" };

/** Galat penulisan XP tidak pernah menggagalkan transaksi: skema belum siap → skipped, lainnya → error. */
function xpFailure(error: unknown, logLabel: string): CrmXpAwardResult {
  if (isMissingCrmSchema(error)) return SCHEMA_NOT_READY;
  console.error(`${logLabel}:`, error);
  return {
    status: "error",
    xpAwarded: 0,
    reason: error instanceof Error ? error.message : "crm_xp_error",
  };
}

/**
 * XP order POS = XP belanja (hanya bayar ARK Coin, EPIC-011) + bonus XP
 * produk. Bonus XP berlaku untuk SEMUA metode bayar: ia hadiah promo tetap
 * per produk yang diset admin, bukan imbalan rupiah belanja, jadi aturan
 * "XP hanya utk ARK Coin" (yang mengatur XP belanja) tidak berlaku.
 */
export async function awardCrmXpForPosOrder(
  db: DbClient,
  payload: PosOrderXpPayload
): Promise<CrmXpAwardResult> {
  if (!payload.customerId) return NO_CUSTOMER;
  const bonus = await awardProductBonusXp(db, payload.customerId, payload);
  const spend = await awardSpendXpForPosOrder(db, payload.customerId, payload);
  if (bonus.xpAwarded <= 0) return spend;
  return {
    status: "posted",
    xpAwarded: spend.xpAwarded + bonus.xpAwarded,
    ledgerIds: [...(spend.ledgerIds ?? []), ...(bonus.ledgerIds ?? [])],
  };
}

function orderProductIds(items: PosOrderItemInput[]) {
  return [
    ...new Set(
      items
        .map((item) => item.product_id ?? item.productId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
}

/** Bonus XP produk sekali per order (idempotency key per order). */
async function awardProductBonusXp(
  db: DbClient,
  customerId: string,
  payload: PosOrderXpPayload
): Promise<CrmXpAwardResult> {
  try {
    const productIds = orderProductIds(payload.items);
    if (productIds.length === 0) return { status: "skipped", xpAwarded: 0 };
    const { data, error } = await db
      .from("pos_products")
      .select("id, bonus_xp")
      .in("id", productIds);
    if (error) {
      if (error.code === "42703") return { status: "skipped", xpAwarded: 0 };
      throw error;
    }
    const bonusByProduct = new Map(
      ((data ?? []) as Array<{ id: string; bonus_xp?: number | string | null }>).map(
        (row) => [row.id, toNumber(row.bonus_xp)]
      )
    );
    const xpAmount = computeProductBonusXp(payload.items, bonusByProduct);
    if (xpAmount <= 0) return { status: "skipped", xpAwarded: 0 };

    const venue = await getCrmDefaultVenue(db);
    return await awardFlatXp(db, {
      customerId,
      xpAmount,
      companyId: venue.companyId,
      branchId: payload.outletId ?? venue.branchId,
      sourceType: "product_bonus",
      sourceId: payload.orderId,
      referenceTable: "pos_orders",
      idempotencyKey: `pos:order:${payload.orderId}:product_bonus`,
      description: `Bonus XP produk — order ${await orderLabel(db, payload.orderId)}`,
    });
  } catch (error) {
    if (isMissingCrmSchema(error)) return { status: "skipped", xpAwarded: 0 };
    console.error("CRM product bonus XP failed:", error);
    return { status: "error", xpAwarded: 0 };
  }
}

/** XP nilai transaksi: aturan crm_xp_rules `order_amount` bila ada, selain itu pengaturan loyalti POS. */
async function resolveOrderAmountXp(
  db: DbClient,
  rules: CrmXpRule[],
  input: { outletId?: string | null; amount: number }
) {
  const rule = findBestRule(rules, {
    sourceType: "order_amount",
    sourceId: null,
    outletId: input.outletId ?? null,
    amount: input.amount,
  });
  if (rule) {
    return { xp: calculateXp(rule, { amount: input.amount, quantity: 1 }), ruleId: rule.id as string | null };
  }
  const settings = await loadPosLoyaltySettings(db);
  return { xp: calculateSpendXp(input.amount, settings), ruleId: null };
}

async function awardSpendXpForPosOrder(
  db: DbClient,
  customerId: string,
  payload: PosOrderXpPayload
): Promise<CrmXpAwardResult> {
  if (!isXpEligiblePayment(payload.paymentMethod)) return NON_ARK;

  try {
    const venue = await getCrmDefaultVenue(db);
    const branchId = payload.outletId ?? venue.branchId;
    const rules = await loadPosXpRules(db);
    if (!rules) return SCHEMA_NOT_READY;

    const productXp = await loadProductXpMap(db, orderProductIds(payload.items));
    const label = await orderLabel(db, payload.orderId);

    const ledgerIds: string[] = [];
    let xpAwarded = 0;
    let productXpPosted = false;
    let duplicateCount = 0;
    const collect = (posted: CrmXpAwardResult) => {
      if (posted.status === "duplicate") duplicateCount += 1;
      xpAwarded += posted.xpAwarded;
      ledgerIds.push(...(posted.ledgerIds ?? []));
    };

    for (const [index, item] of payload.items.entries()) {
      const productId = item.product_id ?? item.productId ?? null;
      if (!productId) continue;

      const quantity = itemQuantity(item);
      const amount = itemAmount(item);
      const rule = findBestRule(rules, {
        sourceType: "product",
        sourceId: productId,
        outletId: payload.outletId ?? null,
        amount,
      });
      const configuredProductXp = productXp.get(productId) ?? 0;

      let xp = 0;
      if (rule) xp = calculateXp(rule, { amount, quantity });
      else if (configuredProductXp > 0) xp = Math.floor(configuredProductXp * quantity);
      if (xp <= 0) continue;

      productXpPosted = true;
      collect(
        await postXpEvent(db, {
          customerId,
          sourceType: "product",
          sourceId: productId,
          outletId: payload.outletId,
          companyId: venue.companyId,
          branchId,
          xpAmount: xp,
          ruleId: rule?.id ?? null,
          referenceTable: "pos_orders",
          referenceId: payload.orderId,
          idempotencyKey: `pos:order:${payload.orderId}:product:${productId}:${index}`,
          description: `XP produk POS — order ${label}`,
          metadata: { amount, quantity, product_id: productId },
        })
      );
    }

    if (!productXpPosted) {
      const { xp, ruleId } = await resolveOrderAmountXp(db, rules, {
        outletId: payload.outletId,
        amount: payload.totalAmount,
      });
      if (xp > 0) {
        collect(
          await postXpEvent(db, {
            customerId,
            sourceType: ruleId ? "order_amount" : "order_amount_settings",
            sourceId: null,
            outletId: payload.outletId,
            companyId: venue.companyId,
            branchId,
            xpAmount: xp,
            ruleId,
            referenceTable: "pos_orders",
            referenceId: payload.orderId,
            idempotencyKey: `pos:order:${payload.orderId}:order_amount`,
            description: `XP transaksi POS — order ${label} (${formatRupiah(payload.totalAmount)})`,
            metadata: { amount: payload.totalAmount, source: ruleId ? "crm_xp_rules" : "pos_loyalty_settings" },
          })
        );
      }
    }

    if (xpAwarded > 0) {
      await syncAfterEarn(db, customerId, xpAwarded);
      return { status: "posted", xpAwarded, ledgerIds };
    }
    if (duplicateCount > 0) return { status: "duplicate", xpAwarded: 0, ledgerIds };
    return { status: "skipped", xpAwarded: 0, reason: "no_matching_xp_rule" };
  } catch (error) {
    return xpFailure(error, "CRM XP order award failed");
  }
}

export async function awardCrmXpForSplitPayment(
  db: DbClient,
  payload: {
    orderId: string;
    splitId: string;
    customerId?: string | null;
    totalAmount: number;
    outletId?: string | null;
    paymentMethod?: string | null;
  }
): Promise<CrmXpAwardResult> {
  if (!payload.customerId) return NO_CUSTOMER;
  if (!isXpEligiblePayment(payload.paymentMethod)) return NON_ARK;

  try {
    const venue = await getCrmDefaultVenue(db);
    const rules = await loadPosXpRules(db);
    if (!rules) return SCHEMA_NOT_READY;

    const { xp, ruleId } = await resolveOrderAmountXp(db, rules, {
      outletId: payload.outletId,
      amount: payload.totalAmount,
    });
    if (xp <= 0) return { status: "skipped", xpAwarded: 0, reason: "no_matching_xp_rule" };

    const posted = await postXpEvent(db, {
      customerId: payload.customerId,
      sourceType: "split_payment",
      sourceId: payload.splitId,
      outletId: payload.outletId,
      companyId: venue.companyId,
      branchId: payload.outletId ?? venue.branchId,
      xpAmount: xp,
      ruleId,
      referenceTable: "pos_order_splits",
      referenceId: payload.splitId,
      idempotencyKey: `pos:split:${payload.splitId}:order_amount`,
      description: `XP split payment POS — order ${await orderLabel(db, payload.orderId)} (${formatRupiah(payload.totalAmount)})`,
      metadata: {
        amount: payload.totalAmount,
        order_id: payload.orderId,
        split_id: payload.splitId,
        source: ruleId ? "crm_xp_rules" : "pos_loyalty_settings",
      },
    });

    if (posted.xpAwarded > 0) await syncAfterEarn(db, payload.customerId, posted.xpAwarded);
    return posted;
  } catch (error) {
    return xpFailure(error, "CRM XP split award failed");
  }
}

export async function awardCrmXpForTopup(
  db: DbClient,
  payload: {
    customerId: string;
    topupAmountIdr: number;
    transactionId: string;
  }
): Promise<CrmXpAwardResult> {
  if (!payload.customerId) return NO_CUSTOMER;

  try {
    const venue = await getCrmDefaultVenue(db);
    const settings = await loadPosLoyaltySettings(db);
    const xp = calculateTopupXp(payload.topupAmountIdr, settings);
    if (xp <= 0) {
      return { status: "skipped", xpAwarded: 0, reason: "topup_xp_disabled_or_zero" };
    }

    const posted = await postXpEvent(db, {
      customerId: payload.customerId,
      sourceType: "topup",
      sourceId: payload.transactionId,
      companyId: venue.companyId,
      branchId: venue.branchId,
      xpAmount: xp,
      referenceTable: "pos_wallet_transactions",
      referenceId: payload.transactionId,
      idempotencyKey: `pos:topup:${payload.transactionId}`,
      description: `XP topup ARK — ${formatRupiah(payload.topupAmountIdr)}`,
      metadata: {
        amount: payload.topupAmountIdr,
        source: "pos_loyalty_settings",
        topup_xp_mode: settings.topup_xp_mode,
      },
    });

    if (posted.xpAwarded > 0) await syncAfterEarn(db, payload.customerId, posted.xpAwarded);
    return posted;
  } catch (error) {
    return xpFailure(error, "CRM XP topup award failed");
  }
}

/**
 * Label order untuk deskripsi ledger (owner 2026-08-31): tampilkan nomor
 * order yang dikenal kasir, bukan UUID internal. Gagal ambil → fallback
 * potongan UUID supaya penulisan XP tidak pernah terhambat.
 */
async function orderLabel(db: DbClient, orderId: string): Promise<string> {
  try {
    const { data } = await db
      .from("pos_orders")
      .select("order_number")
      .eq("id", orderId)
      .maybeSingle();
    if (data?.order_number) return `#${data.order_number}`;
  } catch {
    // deskripsi tidak boleh menggagalkan pemberian XP
  }
  return orderId.slice(0, 8);
}

/** Aturan XP POS aktif urut prioritas; null bila skema CRM belum siap. */
async function loadPosXpRules(db: DbClient): Promise<CrmXpRule[] | null> {
  const { data, error } = await db
    .from("crm_xp_rules")
    .select("*")
    .eq("source_channel", "pos")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) {
    if (isMissingCrmSchema(error)) return null;
    throw error;
  }
  return (data ?? []) as CrmXpRule[];
}

/** XP per produk (kolom xp_points, fallback kolom lama xp). */
async function loadProductXpMap(db: DbClient, productIds: string[]) {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;

  let { data, error } = await db
    .from("pos_products")
    .select("id, xp_points")
    .in("id", productIds);

  if (error) {
    if (error.code !== "42703") throw error;
    ({ data, error } = await db.from("pos_products").select("id, xp").in("id", productIds));
    if (error) {
      if (error.code === "42703") return map;
      throw error;
    }
  }

  ((data ?? []) as Array<{ id: string; xp_points?: number | string | null; xp?: number | string | null }>).forEach(
    (product) => map.set(product.id, toNumber(product.xp_points ?? product.xp))
  );
  return map;
}
