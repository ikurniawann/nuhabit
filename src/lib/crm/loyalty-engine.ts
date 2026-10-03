import type { DbClient } from "@/lib/pg/types";
import { getCrmDefaultVenue, isMissingCrmSchema, toNumber } from "@/lib/crm/server";
import {
  calculateSpendXp,
  calculateTopupXp,
  loadPosLoyaltySettings,
} from "@/lib/pos/loyalty-settings";
import { computeProductBonusXp } from "@/lib/promo/product-bonus-xp";

type PosOrderItemInput = {
  product_id?: string | null;
  productId?: string | null;
  quantity?: number | string | null;
  total_amount?: number | string | null;
  subtotal?: number | string | null;
  unit_price?: number | string | null;
};

type CrmTier = {
  id: string;
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: number | string;
  min_total_spend: number | string;
  xp_multiplier: number | string;
};

type CrmMemberProfile = {
  id: string;
  customer_id: string;
  tier_id: string;
  lifetime_xp: number | string;
  loyalty_score: number | string;
  tier?: Pick<CrmTier, "id" | "code" | "name" | "rank" | "xp_multiplier"> | null;
};

type PosCustomerLoyaltyRow = {
  id: string;
  phone?: string | null;
  membership_tier?: string | null;
  total_xp?: number | string | null;
  current_xp?: number | string | null;
  total_spent?: number | string | null;
  visit_count?: number | string | null;
};

// XP hanya diberikan untuk pembayaran penuh dengan ARK Coin (EPIC-011).
export const XP_ELIGIBLE_PAYMENT_METHOD = "ark_coin";

function isXpEligiblePayment(paymentMethod?: string | null) {
  return String(paymentMethod ?? "").toLowerCase() === XP_ELIGIBLE_PAYMENT_METHOD;
}

type ProductXpRow = {
  id: string;
  xp_points?: number | string | null;
  xp?: number | string | null;
};

type CrmXpRule = {
  id: string;
  source_channel: string;
  source_type: string;
  source_id: string | null;
  outlet_scope: "all" | "specific";
  outlet_id: string | null;
  xp_mode: "fixed" | "per_item" | "per_amount" | "multiplier" | "percentage";
  xp_value: number | string;
  amount_step: number | string;
  min_amount: number | string;
  max_xp_per_event: number | string | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

export type CrmXpAwardResult = {
  status: "posted" | "skipped" | "duplicate" | "error";
  xpAwarded: number;
  reason?: string;
  ledgerIds?: string[];
  details?: unknown;
};

type PostXpEventInput = {
  customerId: string;
  sourceType: string;
  sourceId?: string | null;
  outletId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  xpAmount: number;
  ruleId?: string | null;
  referenceTable: string;
  referenceId: string;
  idempotencyKey: string;
  description: string;
  metadata?: Record<string, unknown>;
  /** false = XP nominal apa adanya (mis. Free XP profil) — tanpa multiplier tier */
  applyTierMultiplier?: boolean;
  /** Kanal ledger; default "pos". Partner eksternal memakai kanalnya sendiri. */
  sourceChannel?: string;
};

type PosOrderXpPayload = {
  orderId: string;
  customerId?: string | null;
  totalAmount: number;
  items: PosOrderItemInput[];
  outletId?: string | null;
  paymentMethod?: string | null;
};

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
  if (!payload.customerId) {
    return { status: "skipped", xpAwarded: 0, reason: "no_customer" };
  }
  const bonus = await awardProductBonusXp(db, payload);
  const spend = await awardSpendXpForPosOrder(db, payload);
  if (bonus.xpAwarded <= 0) return spend;
  return {
    status: "posted",
    xpAwarded: spend.xpAwarded + bonus.xpAwarded,
    ledgerIds: [...(spend.ledgerIds ?? []), ...(bonus.ledgerIds ?? [])],
  };
}

/** Bonus XP produk sekali per order (idempotency key per order). */
async function awardProductBonusXp(
  db: DbClient,
  payload: PosOrderXpPayload
): Promise<CrmXpAwardResult> {
  const customerId = payload.customerId!;
  try {
    const productIds = [
      ...new Set(
        payload.items
          .map((item) => item.product_id ?? item.productId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
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

async function awardSpendXpForPosOrder(
  db: DbClient,
  payload: PosOrderXpPayload
): Promise<CrmXpAwardResult> {
  if (!payload.customerId) {
    return { status: "skipped", xpAwarded: 0, reason: "no_customer" };
  }

  if (!isXpEligiblePayment(payload.paymentMethod)) {
    return { status: "skipped", xpAwarded: 0, reason: "non_ark_payment" };
  }

  try {
    const venue = await getCrmDefaultVenue(db);
    const branchId = payload.outletId ?? venue.branchId;
    const rules = await loadPosXpRules(db);
    if (!rules.ready) return rules.result;

    const productIds = payload.items
      .map((item) => item.product_id ?? item.productId ?? null)
      .filter((value): value is string => Boolean(value));
    const productXp = await loadProductXpMap(db, productIds);
    const label = await orderLabel(db, payload.orderId);

    const ledgerIds: string[] = [];
    let xpAwarded = 0;
    let productXpPosted = false;
    let duplicateCount = 0;

    for (const [index, item] of payload.items.entries()) {
      const productId = item.product_id ?? item.productId ?? null;
      if (!productId) continue;

      const quantity = Math.max(1, toNumber(item.quantity) || 1);
      const amount = itemAmount(item);
      const rule = findBestRule(rules.data, {
        sourceType: "product",
        sourceId: productId,
        outletId: payload.outletId ?? null,
        amount,
      });
      const configuredProductXp = productXp.get(productId) ?? 0;

      let xp = 0;
      let ruleId: string | null = null;
      if (rule) {
        xp = calculateXp(rule, { amount, quantity });
        ruleId = rule.id;
      } else if (configuredProductXp > 0) {
        xp = Math.floor(configuredProductXp * quantity);
      }

      if (xp <= 0) continue;

      productXpPosted = true;
      const posted = await postXpEvent(db, {
        customerId: payload.customerId,
        sourceType: "product",
        sourceId: productId,
        outletId: payload.outletId,
        companyId: venue.companyId,
        branchId,
        xpAmount: xp,
        ruleId,
        referenceTable: "pos_orders",
        referenceId: payload.orderId,
        idempotencyKey: `pos:order:${payload.orderId}:product:${productId}:${index}`,
        description: `XP produk POS — order ${label}`,
        metadata: { amount, quantity, product_id: productId },
      });

      if (posted.status === "duplicate") duplicateCount += 1;
      xpAwarded += posted.xpAwarded;
      ledgerIds.push(...(posted.ledgerIds ?? []));
    }

    if (!productXpPosted) {
      const orderRule = findBestRule(rules.data, {
        sourceType: "order_amount",
        sourceId: null,
        outletId: payload.outletId ?? null,
        amount: payload.totalAmount,
      });

      let xp = 0;
      let ruleId: string | null = null;
      let sourceType = "order_amount";

      if (orderRule) {
        xp = calculateXp(orderRule, { amount: payload.totalAmount, quantity: 1 });
        ruleId = orderRule.id;
      } else {
        const loyaltySettings = await loadPosLoyaltySettings(db);
        xp = calculateSpendXp(payload.totalAmount, loyaltySettings);
        sourceType = "order_amount_settings";
      }

      if (xp > 0) {
        const posted = await postXpEvent(db, {
          customerId: payload.customerId,
          sourceType,
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
        });

        if (posted.status === "duplicate") duplicateCount += 1;
        xpAwarded += posted.xpAwarded;
        ledgerIds.push(...(posted.ledgerIds ?? []));
      }
    }

    if (xpAwarded > 0) {
      await syncPosCustomerAfterEarn(db, payload.customerId, xpAwarded);
      await syncTierAfterEarn(db, payload.customerId);
      return { status: "posted", xpAwarded, ledgerIds };
    }

    if (duplicateCount > 0) {
      return { status: "duplicate", xpAwarded: 0, ledgerIds };
    }

    return { status: "skipped", xpAwarded: 0, reason: "no_matching_xp_rule" };
  } catch (error) {
    if (isMissingCrmSchema(error)) {
      return { status: "skipped", xpAwarded: 0, reason: "crm_schema_not_ready" };
    }

    console.error("CRM XP order award failed:", error);
    return {
      status: "error",
      xpAwarded: 0,
      reason: error instanceof Error ? error.message : "crm_xp_error",
    };
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
  if (!payload.customerId) {
    return { status: "skipped", xpAwarded: 0, reason: "no_customer" };
  }

  if (!isXpEligiblePayment(payload.paymentMethod)) {
    return { status: "skipped", xpAwarded: 0, reason: "non_ark_payment" };
  }

  try {
    const venue = await getCrmDefaultVenue(db);
    const branchId = payload.outletId ?? venue.branchId;
    const rules = await loadPosXpRules(db);
    if (!rules.ready) return rules.result;

    const orderRule = findBestRule(rules.data, {
      sourceType: "order_amount",
      sourceId: null,
      outletId: payload.outletId ?? null,
      amount: payload.totalAmount,
    });

    let xp = 0;
    let ruleId: string | null = null;
    if (orderRule) {
      xp = calculateXp(orderRule, { amount: payload.totalAmount, quantity: 1 });
      ruleId = orderRule.id;
    } else {
      const loyaltySettings = await loadPosLoyaltySettings(db);
      xp = calculateSpendXp(payload.totalAmount, loyaltySettings);
    }

    if (xp <= 0) {
      return { status: "skipped", xpAwarded: 0, reason: "no_matching_xp_rule" };
    }

    const posted = await postXpEvent(db, {
      customerId: payload.customerId,
      sourceType: "split_payment",
      sourceId: payload.splitId,
      outletId: payload.outletId,
      companyId: venue.companyId,
      branchId,
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

    if (posted.xpAwarded > 0) {
      await syncPosCustomerAfterEarn(db, payload.customerId, posted.xpAwarded);
      await syncTierAfterEarn(db, payload.customerId);
    }

    return posted;
  } catch (error) {
    if (isMissingCrmSchema(error)) {
      return { status: "skipped", xpAwarded: 0, reason: "crm_schema_not_ready" };
    }

    console.error("CRM XP split award failed:", error);
    return {
      status: "error",
      xpAwarded: 0,
      reason: error instanceof Error ? error.message : "crm_xp_error",
    };
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
  if (!payload.customerId) {
    return { status: "skipped", xpAwarded: 0, reason: "no_customer" };
  }

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

    if (posted.xpAwarded > 0) {
      await syncPosCustomerAfterEarn(db, payload.customerId, posted.xpAwarded);
      await syncTierAfterEarn(db, payload.customerId);
    }

    return posted;
  } catch (error) {
    if (isMissingCrmSchema(error)) {
      return { status: "skipped", xpAwarded: 0, reason: "crm_schema_not_ready" };
    }

    console.error("CRM XP topup award failed:", error);
    return {
      status: "error",
      xpAwarded: 0,
      reason: error instanceof Error ? error.message : "crm_xp_error",
    };
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

export function formatRupiah(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}

async function loadPosXpRules(db: DbClient): Promise<
  | { ready: true; data: CrmXpRule[] }
  | { ready: false; result: CrmXpAwardResult }
> {
  const { data, error } = await db
    .from("crm_xp_rules")
    .select("*")
    .eq("source_channel", "pos")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) {
    if (isMissingCrmSchema(error)) {
      return { ready: false, result: { status: "skipped", xpAwarded: 0, reason: "crm_schema_not_ready" } };
    }
    throw error;
  }

  return { ready: true, data: (data ?? []) as CrmXpRule[] };
}

async function loadProductXpMap(db: DbClient, productIds: string[]) {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;

  let { data, error } = await db
    .from("pos_products")
    .select("id, xp_points")
    .in("id", Array.from(new Set(productIds)));

  if (error) {
    if (error.code !== "42703") throw error;

    const fallback = await db
      .from("pos_products")
      .select("id, xp")
      .in("id", Array.from(new Set(productIds)));

    if (fallback.error) {
      if (fallback.error.code === "42703") return map;
      throw fallback.error;
    }

    data = fallback.data;
    error = fallback.error;
  }

  ((data ?? []) as ProductXpRow[]).forEach((product) => {
    map.set(product.id, toNumber(product.xp_points ?? product.xp));
  });

  return map;
}

function findBestRule(
  rules: CrmXpRule[],
  input: { sourceType: string; sourceId: string | null; outletId: string | null; amount: number }
) {
  const now = Date.now();

  return rules.find((rule) => {
    if (rule.source_type !== input.sourceType) return false;
    if ((rule.source_id ?? null) !== (input.sourceId ?? null)) return false;
    if (rule.outlet_scope === "specific" && rule.outlet_id !== input.outletId) return false;
    if (rule.starts_at && new Date(rule.starts_at).getTime() > now) return false;
    if (rule.ends_at && new Date(rule.ends_at).getTime() < now) return false;
    if (input.amount < toNumber(rule.min_amount)) return false;
    return true;
  });
}

function calculateXp(rule: CrmXpRule, input: { amount: number; quantity: number }) {
  const value = toNumber(rule.xp_value);
  const amountStep = Math.max(1, toNumber(rule.amount_step) || 1);
  let xp = 0;

  if (rule.xp_mode === "fixed") xp = value;
  if (rule.xp_mode === "per_item") xp = value * input.quantity;
  if (rule.xp_mode === "per_amount") xp = Math.floor(input.amount / amountStep) * value;
  if (rule.xp_mode === "multiplier") xp = input.amount * value;
  if (rule.xp_mode === "percentage") xp = input.amount * (value / 100);

  const capped = rule.max_xp_per_event != null ? Math.min(xp, toNumber(rule.max_xp_per_event)) : xp;
  return Math.max(0, Math.floor(capped));
}

async function postXpEvent(db: DbClient, input: PostXpEventInput): Promise<CrmXpAwardResult> {
  if (input.xpAmount <= 0) {
    return { status: "skipped", xpAwarded: 0, reason: "zero_xp" };
  }

  const existing = await db
    .from("crm_xp_ledger")
    .select("id, xp_delta")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existing.error && !isMissingCrmSchema(existing.error)) throw existing.error;
  if (existing.data) {
    return { status: "duplicate", xpAwarded: 0, ledgerIds: [existing.data.id] };
  }

  const member = await ensureMemberProfile(db, input.customerId);
  if (!member) return { status: "skipped", xpAwarded: 0, reason: "member_profile_unavailable" };

  const tierMultiplier =
    input.applyTierMultiplier === false
      ? 1
      : input.ruleId ? await getTierMultiplierForRule(db, input.ruleId, member) : toNumber(member.tier?.xp_multiplier) || 1;
  const xpDelta = Math.max(0, Math.floor(input.xpAmount * tierMultiplier));
  if (xpDelta <= 0) return { status: "skipped", xpAwarded: 0, reason: "zero_xp" };

  // XP lifetime append-only (EPIC-011): tidak ada lagi saldo XP terpisah —
  // balance_* di ledger diisi nilai lifetime agar kolom NOT NULL tetap valid.
  const lifetimeBefore = toNumber(member.lifetime_xp);
  const lifetimeAfter = lifetimeBefore + xpDelta;

  const { data: ledger, error: ledgerError } = await db
    .from("crm_xp_ledger")
    .insert({
      member_id: member.id,
      customer_id: input.customerId,
      direction: "earn",
      source_channel: input.sourceChannel ?? "pos",
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      outlet_id: input.outletId ?? null,
      company_id: input.companyId ?? null,
      branch_id: input.branchId ?? null,
      xp_delta: xpDelta,
      balance_before: lifetimeBefore,
      balance_after: lifetimeAfter,
      lifetime_before: lifetimeBefore,
      lifetime_after: lifetimeAfter,
      rule_id: input.ruleId ?? null,
      reference_table: input.referenceTable,
      reference_id: input.referenceId,
      idempotency_key: input.idempotencyKey,
      description: input.description,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (ledgerError) {
    if (ledgerError.code === "23505") return { status: "duplicate", xpAwarded: 0 };
    throw ledgerError;
  }

  const { error: profileError } = await db
    .from("crm_member_profiles")
    .update({
      lifetime_xp: lifetimeAfter,
      loyalty_score: lifetimeAfter,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", member.id);

  if (profileError) throw profileError;

  return { status: "posted", xpAwarded: xpDelta, ledgerIds: ledger?.id ? [ledger.id] : [] };
}

async function ensureMemberProfile(db: DbClient, customerId: string): Promise<CrmMemberProfile | null> {
  const existing = await db
    .from("crm_member_profiles")
    .select("*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier)")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (existing.error && !isMissingCrmSchema(existing.error)) throw existing.error;
  if (existing.data) return existing.data as CrmMemberProfile;

  const { data: customer, error: customerError } = await db
    .from("pos_customers")
    .select("id, phone, membership_tier, total_xp, total_spent")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer) return null;

  const customerRow = customer as PosCustomerLoyaltyRow;
  const tierCode = String(customerRow.membership_tier || "regular").toLowerCase();
  let tier = await findTierByCode(db, tierCode);
  if (!tier) tier = await findTierByCode(db, "regular");
  if (!tier) return null;

  const memberPayload: Record<string, unknown> = {
    customer_id: customerId,
    tier_id: tier.id,
    lifetime_xp: toNumber(customerRow.total_xp),
    loyalty_score: toNumber(customerRow.total_xp),
    status: "active",
    metadata: { enrolled_by: "pos_checkout" },
    last_activity_at: new Date().toISOString(),
  };
  if (customerRow.phone) {
    memberPayload.member_code = `ARK-${String(customerRow.phone).replace(/\D/g, "").slice(-10)}`;
  }

  const { data: inserted, error: insertError } = await db
    .from("crm_member_profiles")
    .insert(memberPayload)
    .select("*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier)")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const retry = await db
        .from("crm_member_profiles")
        .select("*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier)")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (retry.error) throw retry.error;
      return retry.data as CrmMemberProfile | null;
    }
    throw insertError;
  }

  return inserted as CrmMemberProfile;
}

async function findTierByCode(db: DbClient, code: string): Promise<CrmTier | null> {
  const { data, error } = await db
    .from("crm_membership_tiers")
    .select("*")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (error && !isMissingCrmSchema(error)) throw error;
  return (data as CrmTier | null) ?? null;
}

async function getTierMultiplierForRule(db: DbClient, ruleId: string, member: CrmMemberProfile) {
  const { data: rule } = await db
    .from("crm_xp_rules")
    .select("tier_multiplier_enabled")
    .eq("id", ruleId)
    .maybeSingle();

  if (!rule?.tier_multiplier_enabled) return 1;
  return toNumber(member.tier?.xp_multiplier) || 1;
}

async function syncPosCustomerAfterEarn(db: DbClient, customerId: string, xpAwarded: number) {
  const { data: customer, error } = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", customerId)
    .maybeSingle();

  if (error || !customer) return;

  // Visit/spend stats live in syncPosCustomerOrderStats (CRM revamp) —
  // this helper only mirrors XP onto pos_customers. current_xp sudah di-DROP
  // pada EPIC-011 Fase B; referensinya dibersihkan (EPIC-014, 25 Jul 2026).
  await db
    .from("pos_customers")
    .update({
      total_xp: toNumber((customer as PosCustomerLoyaltyRow).total_xp) + xpAwarded,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId);
}

/**
 * Statistik kunjungan/belanja customer — dipanggil untuk SETIAP order dibayar
 * apapun metodenya (terpisah dari XP yang hanya untuk pembayaran ARK Coin).
 * total_spent = nilai belanja/order (topup TIDAK dihitung) — dasar top spender.
 */
export async function syncPosCustomerOrderStats(
  db: DbClient,
  customerId: string,
  amount: number
) {
  try {
    const { data: customer, error } = await db
      .from("pos_customers")
      .select("total_spent, visit_count")
      .eq("id", customerId)
      .maybeSingle();

    if (error || !customer) return;

    await db
      .from("pos_customers")
      .update({
        total_spent: toNumber((customer as PosCustomerLoyaltyRow).total_spent) + amount,
        visit_count: toNumber((customer as PosCustomerLoyaltyRow).visit_count) + 1,
        last_visit: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", customerId);
  } catch (error) {
    console.error("CRM customer stats sync failed:", error);
  }
}

export async function syncTierAfterEarn(db: DbClient, customerId: string) {
  const { data: profile, error: profileError } = await db
    .from("crm_member_profiles")
    .select("id, tier_id, lifetime_xp")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (profileError || !profile) return;

  const { data: tiers, error: tiersError } = await db
    .from("crm_membership_tiers")
    .select("*")
    .eq("is_active", true)
    .order("rank", { ascending: false });

  if (tiersError || !tiers?.length) return;

  // Tier ditentukan MURNI dari lifetime XP (keputusan owner EPIC-011), dan
  // sumber XP kanonik = pos_customers.total_xp (keputusan EPIC-014 25 Jul —
  // lifetime_xp profil hanya mirror; bila keduanya sempat menyimpang, angka
  // customer yang menang). Fallback ke mirror bila baris customer tak terbaca.
  const profileRow = profile as Pick<CrmMemberProfile, "id" | "tier_id" | "lifetime_xp">;
  const { data: customer } = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", customerId)
    .maybeSingle();
  const lifetimeXp =
    customer != null
      ? toNumber((customer as PosCustomerLoyaltyRow).total_xp)
      : toNumber(profileRow.lifetime_xp);
  const nextTier = (tiers as CrmTier[]).find(
    (tier) => lifetimeXp >= toNumber(tier.min_lifetime_xp)
  );

  if (nextTier && nextTier.id !== profileRow.tier_id) {
    await db
      .from("crm_member_profiles")
      .update({ tier_id: nextTier.id })
      .eq("id", profileRow.id);

    await db
      .from("pos_customers")
      .update({ membership_tier: nextTier.code, updated_at: new Date().toISOString() })
      .eq("id", customerId);
  }
}

function itemAmount(item: PosOrderItemInput) {
  const quantity = Math.max(1, toNumber(item.quantity) || 1);
  if (item.total_amount != null) return toNumber(item.total_amount);
  if (item.subtotal != null) return toNumber(item.subtotal);
  return toNumber(item.unit_price) * quantity;
}

/**
 * Tarik kembali XP order yang di-void (keputusan owner 2026-08-23): saldo ARK
 * di-refund, statistik belanja dikoreksi, maka XP juga harus dibatalkan.
 *
 * Cara kerja: jumlahkan baris `earn` ledger yang mereferensikan order-order
 * tsb, tulis satu baris `reverse` per order (idempoten via idempotency_key
 * `pos:order:<id>:void_reverse` — retry void tidak dobel-tarik), turunkan
 * pos_customers.total_xp (kanonik) + mirror lifetime_xp profil (clamp ≥ 0,
 * sesuai constraint ledger), lalu sinkron ulang tier — tier BISA turun.
 */
export async function reverseCrmXpForVoidedOrders(
  db: DbClient,
  payload: { orderIds: string[]; voidReason?: string | null }
): Promise<{ xpReversed: number }> {
  if (payload.orderIds.length === 0) return { xpReversed: 0 };

  try {
    const { data: earnRows, error: earnError } = await db
      .from("crm_xp_ledger")
      .select("id, customer_id, member_id, xp_delta, outlet_id, company_id, branch_id, reference_id")
      .eq("reference_table", "pos_orders")
      .eq("direction", "earn")
      .in("reference_id", payload.orderIds);
    if (earnError) throw earnError;
    if (!earnRows || earnRows.length === 0) return { xpReversed: 0 };

    const reverseKeys = payload.orderIds.map((id) => `pos:order:${id}:void_reverse`);
    const { data: existingReverse } = await db
      .from("crm_xp_ledger")
      .select("idempotency_key")
      .in("idempotency_key", reverseKeys);
    const alreadyReversed = new Set(
      ((existingReverse ?? []) as Array<{ idempotency_key?: unknown }>).map((row) =>
        String(row.idempotency_key)
      )
    );

    type EarnRow = {
      customer_id: string;
      member_id: string;
      xp_delta: number | string;
      outlet_id: string | null;
      company_id: string | null;
      branch_id: string | null;
      reference_id: string;
    };
    const xpByOrder = new Map<string, { xp: number; row: EarnRow }>();
    for (const raw of earnRows as EarnRow[]) {
      const orderId = String(raw.reference_id);
      if (alreadyReversed.has(`pos:order:${orderId}:void_reverse`)) continue;
      const entry = xpByOrder.get(orderId) ?? { xp: 0, row: raw };
      entry.xp += toNumber(raw.xp_delta);
      xpByOrder.set(orderId, entry);
    }
    if (xpByOrder.size === 0) return { xpReversed: 0 };

    const first = [...xpByOrder.values()][0].row;
    const customerId = String(first.customer_id);

    let xpReversed = 0;
    for (const [orderId, entry] of xpByOrder) {
      if (entry.xp <= 0) continue;

      const { data: customer } = await db
        .from("pos_customers")
        .select("total_xp")
        .eq("id", customerId)
        .maybeSingle();
      const lifetimeBefore = toNumber((customer as PosCustomerLoyaltyRow | null)?.total_xp);
      // Clamp: XP member tidak boleh negatif (constraint ledger juga menolak).
      const delta = Math.min(entry.xp, lifetimeBefore);
      if (delta <= 0) continue;
      const lifetimeAfter = lifetimeBefore - delta;

      const { error: ledgerError } = await db.from("crm_xp_ledger").insert({
        member_id: entry.row.member_id,
        customer_id: customerId,
        direction: "reverse",
        source_channel: "pos",
        source_type: "order_void",
        source_id: orderId,
        outlet_id: entry.row.outlet_id,
        company_id: entry.row.company_id,
        branch_id: entry.row.branch_id,
        xp_delta: -delta,
        balance_before: lifetimeBefore,
        balance_after: lifetimeAfter,
        lifetime_before: lifetimeBefore,
        lifetime_after: lifetimeAfter,
        reference_table: "pos_orders",
        reference_id: orderId,
        idempotency_key: `pos:order:${orderId}:void_reverse`,
        description: `Pembatalan XP — void order${payload.voidReason ? ` (${payload.voidReason})` : ""}`,
        metadata: { void: true },
      });
      if (ledgerError) {
        // 23505 = reversal sudah tercatat oleh proses lain — bukan error.
        if ((ledgerError as { code?: string }).code === "23505") continue;
        throw ledgerError;
      }

      await db
        .from("pos_customers")
        .update({ total_xp: lifetimeAfter, updated_at: new Date().toISOString() })
        .eq("id", customerId);
      await db
        .from("crm_member_profiles")
        .update({ lifetime_xp: lifetimeAfter, loyalty_score: lifetimeAfter })
        .eq("id", entry.row.member_id);

      xpReversed += delta;
    }

    if (xpReversed > 0) {
      await syncTierAfterEarn(db, customerId);
    }
    return { xpReversed };
  } catch (error) {
    if (isMissingCrmSchema(error)) return { xpReversed: 0 };
    throw error;
  }
}

/**
 * XP nominal (tanpa multiplier tier) untuk sumber non-order: Free XP profil,
 * hadiah challenge. Idempoten lewat idempotency_key ledger; XP yang terposting
 * disalin ke pos_customers.total_xp lalu tier dievaluasi ulang — sama seperti
 * alur XP order (tanpa ini total_xp customer tidak bergerak).
 */
async function awardFlatXp(
  db: DbClient,
  input: {
    customerId: string;
    xpAmount: number;
    companyId?: string | null;
    branchId?: string | null;
    sourceType: string;
    sourceId: string;
    referenceTable: string;
    idempotencyKey: string;
    description: string;
    sourceChannel?: string;
  }
): Promise<CrmXpAwardResult> {
  const result = await postXpEvent(db, {
    sourceChannel: input.sourceChannel,
    customerId: input.customerId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    companyId: input.companyId ?? null,
    branchId: input.branchId ?? null,
    xpAmount: Math.max(0, Math.floor(input.xpAmount)),
    referenceTable: input.referenceTable,
    referenceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    description: input.description,
    applyTierMultiplier: false,
  });

  if (result.status === "posted") {
    await syncPosCustomerAfterEarn(db, input.customerId, result.xpAwarded);
    await syncTierAfterEarn(db, input.customerId);
  }
  return result;
}

/**
 * Free XP kelengkapan profil 100% (EPIC-011 Fase D, keputusan owner #9):
 * berlaku SEMUA tipe member, sekali seumur hidup, TANPA multiplier tier
 * (nominal apa adanya dari crm_settings.profile_completion_free_xp).
 * Idempoten dua lapis: idempotency_key ledger + free_xp_granted_at customer.
 */
export function awardMemberFreeXp(
  db: DbClient,
  input: {
    customerId: string;
    xpAmount: number;
    companyId?: string | null;
    branchId?: string | null;
  }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    ...input,
    sourceType: "profile_completion",
    sourceId: input.customerId,
    referenceTable: "pos_customers",
    idempotencyKey: `portal:profile-complete:${input.customerId}`,
    description: "Free XP profil lengkap (portal member)",
  });
}

/** Hadiah XP challenge selesai — sekali per member per challenge. */
export function awardChallengeXp(
  db: DbClient,
  input: {
    customerId: string;
    challengeId: string;
    challengeTitle: string;
    xpAmount: number;
    companyId?: string | null;
    branchId?: string | null;
  }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    customerId: input.customerId,
    xpAmount: input.xpAmount,
    companyId: input.companyId,
    branchId: input.branchId,
    sourceType: "challenge",
    sourceId: input.challengeId,
    referenceTable: "challenges",
    idempotencyKey: `challenge:${input.challengeId}:${input.customerId}`,
    description: `Hadiah challenge: ${input.challengeTitle}`,
  });
}

/** Bonus XP badge — sekali per member per badge (idempotency key ledger). */
export function awardBadgeBonusXp(
  db: DbClient,
  input: {
    customerId: string;
    badgeId: string;
    badgeName: string;
    xpAmount: number;
    companyId?: string | null;
    branchId?: string | null;
  }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    customerId: input.customerId,
    xpAmount: input.xpAmount,
    companyId: input.companyId,
    branchId: input.branchId,
    sourceType: "badge_bonus",
    sourceId: input.badgeId,
    referenceTable: "crm_badges",
    idempotencyKey: `badge:${input.badgeId}:${input.customerId}`,
    description: `Bonus badge: ${input.badgeName}`,
  });
}

/** XP dari event partner loyalty — sekali per event (idempotency key ledger). */
export function awardPartnerEventXp(
  db: DbClient,
  input: {
    customerId: string;
    eventId: string;
    sourceChannel: string;
    description: string;
    xpAmount: number;
    companyId?: string | null;
    branchId?: string | null;
  }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    customerId: input.customerId,
    xpAmount: input.xpAmount,
    companyId: input.companyId,
    branchId: input.branchId,
    sourceChannel: input.sourceChannel,
    sourceType: "partner_event",
    sourceId: input.eventId,
    referenceTable: "crm_external_events",
    idempotencyKey: `partner-event:${input.eventId}`,
    description: input.description,
  });
}

/**
 * Penyesuaian XP manual oleh admin (positif atau negatif) dengan alasan.
 * Satu `requestId` = satu baris ledger, jadi klik ganda tidak menggandakan.
 * Pengurangan dijepit agar XP tidak negatif; tier dievaluasi ulang (bisa turun).
 */
export async function adjustMemberXp(
  db: DbClient,
  input: {
    customerId: string;
    delta: number;
    reason: string;
    actorId: string;
    requestId: string;
    companyId?: string | null;
    branchId?: string | null;
  }
): Promise<{ status: "posted" | "duplicate" | "skipped"; xpDelta: number; totalXp: number }> {
  const idempotencyKey = `admin-adjust:${input.requestId}`;
  const existing = await db
    .from("crm_xp_ledger")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const { data: customer, error: customerError } = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", input.customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  const before = toNumber((customer as PosCustomerLoyaltyRow | null)?.total_xp);
  if (existing.data) return { status: "duplicate", xpDelta: 0, totalXp: before };

  const requested = Math.trunc(input.delta);
  const applied = requested < 0 ? -Math.min(-requested, before) : requested;
  const member = applied !== 0 ? await ensureMemberProfile(db, input.customerId) : null;
  if (!member || applied === 0) return { status: "skipped", xpDelta: 0, totalXp: before };
  const after = before + applied;

  const { error: ledgerError } = await db.from("crm_xp_ledger").insert({
    member_id: member.id,
    customer_id: input.customerId,
    direction: "adjust",
    source_channel: "manual",
    source_type: "admin_adjustment",
    source_id: input.actorId,
    company_id: input.companyId ?? null,
    branch_id: input.branchId ?? null,
    xp_delta: applied,
    balance_before: before,
    balance_after: after,
    lifetime_before: before,
    lifetime_after: after,
    reference_table: "pos_customers",
    reference_id: input.customerId,
    idempotency_key: idempotencyKey,
    description: `Penyesuaian admin: ${input.reason}`,
    metadata: { reason: input.reason, actor_id: input.actorId, requested_delta: requested },
  });
  if (ledgerError) {
    if ((ledgerError as { code?: string }).code === "23505") {
      return { status: "duplicate", xpDelta: 0, totalXp: before };
    }
    throw ledgerError;
  }

  const now = new Date().toISOString();
  await db.from("pos_customers").update({ total_xp: after, updated_at: now }).eq("id", input.customerId);
  await db
    .from("crm_member_profiles")
    .update({ lifetime_xp: after, loyalty_score: after, last_activity_at: now })
    .eq("id", member.id);
  await syncTierAfterEarn(db, input.customerId);
  return { status: "posted", xpDelta: applied, totalXp: after };
}
