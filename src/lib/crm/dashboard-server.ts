import "server-only";
/** Ringkasan dashboard CRM: statistik member, top member, aktivitas XP terbaru. */
import { queryOne } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import type { DbClient } from "@/lib/pg/types";
import { humanizeLedgerDescription, ledgerOrderIds, type LedgerDescriptionRow } from "./ledger-description";
import { isMissingCrmSchema, toNumber } from "./server";

const POS_CUSTOMER_COLUMNS = "id, name, phone, email, membership_tier, ark_coin_balance, total_xp, total_spent, visit_count, is_active";

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email?: string | null;
  membership_tier: string | null;
  ark_coin_balance: number | string | null;
  total_xp: number | string | null;
  total_spent: number | string | null;
  visit_count: number | string | null;
  is_active: boolean | null;
};

function normalizeCustomer(customer: CustomerRow) {
  return {
    id: customer.id,
    name: customer.name ?? "Walk-in Customer",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    membership_tier: customer.membership_tier ?? "regular",
    ark_coin_balance: toNumber(customer.ark_coin_balance),
    total_xp: toNumber(customer.total_xp),
    total_spent: toNumber(customer.total_spent),
    visit_count: toNumber(customer.visit_count),
    is_active: customer.is_active !== false,
  };
}

async function countTable(db: DbClient, table: string) {
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) {
    if (isMissingCrmSchema(error)) return { count: 0, ready: false };
    throw error;
  }
  return { count: count ?? 0, ready: true };
}

async function topCustomersBy(db: DbClient, column: "total_xp" | "total_spent") {
  const { data, error } = await db
    .from("pos_customers")
    .select(POS_CUSTOMER_COLUMNS)
    .eq("is_active", true)
    .order(column, { ascending: false })
    .limit(5);
  if (error) throw error;
  return ((data ?? []) as CustomerRow[]).map(normalizeCustomer);
}

/** 5 member dengan pemakaian ARK Coin terbesar (dari 1000 order ARK terakhir). */
async function topArkSpenders(db: DbClient) {
  const { data: arkOrders, error } = await db
    .from("pos_orders")
    .select("customer_id, ark_coins_used")
    .not("customer_id", "is", null)
    .gt("ark_coins_used", 0)
    .limit(1000);

  const totals = new Map<string, number>();
  if (!error) {
    for (const order of (arkOrders ?? []) as Array<{ customer_id: string | null; ark_coins_used: number | string | null }>) {
      if (!order.customer_id) continue;
      totals.set(order.customer_id, (totals.get(order.customer_id) ?? 0) + toNumber(order.ark_coins_used));
    }
  }
  const topIds = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([customerId]) => customerId);

  const byId = new Map<string, CustomerRow>();
  if (topIds.length > 0) {
    const { data } = await db.from("pos_customers").select(POS_CUSTOMER_COLUMNS).in("id", topIds);
    for (const customer of (data ?? []) as CustomerRow[]) byId.set(customer.id, customer);
  }
  return topIds.map((customerId) => {
    const customer = byId.get(customerId);
    return { customer: customer ? normalizeCustomer(customer) : null, ark_coins_used: totals.get(customerId) ?? 0 };
  });
}

/** 8 baris ledger XP terbaru dengan deskripsi lama dirapikan. */
async function recentXpActivity(db: DbClient): Promise<unknown[]> {
  const { data: ledgerRows, error: ledgerError } = await db
    .from("crm_xp_ledger")
    .select("id, direction, source_channel, source_type, xp_delta, balance_after, description, created_at, reference_table, reference_id, metadata, member:crm_member_profiles(member_code, customer_id)")
    .order("created_at", { ascending: false })
    .limit(8);

  const rows = (ledgerRows ?? []) as Array<LedgerDescriptionRow & Record<string, unknown>>;
  const orderIds = ledgerOrderIds(rows);
  const orderNumbers = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: orderRows } = await db.from("pos_orders").select("id, order_number").in("id", orderIds);
    for (const o of (orderRows ?? []) as { id: string; order_number: string | null }[]) {
      if (o.order_number) orderNumbers.set(o.id, o.order_number);
    }
  }
  if (ledgerError) return [];
  return rows.map((row) => {
    const description = humanizeLedgerDescription(row, orderNumbers);
    return description === (row.description ?? "") ? row : { ...row, description };
  });
}

export async function loadCrmDashboard() {
  const db = createPgClient();

  const { count: totalCustomers, error: customerCountError } = await db
    .from("pos_customers")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (customerCountError) throw customerCountError;

  // Skema baru EPIC-011: breakdown tipe member + liabilitas ARK beredar.
  const memberSummary = await queryOne<{ card_members: unknown; registered_members: unknown; ark_outstanding: unknown }>(
    `SELECT
       COUNT(*) FILTER (WHERE member_type = 'card') AS card_members,
       COUNT(*) FILTER (WHERE member_type = 'registered') AS registered_members,
       COALESCE(SUM(ark_coin_balance), 0) AS ark_outstanding
     FROM pos.pos_customers
     WHERE is_active`
  );

  const [memberCount, tierCount, xpRuleCount, rewardCount, avatarCount, redemptionCount, eventCount] =
    await Promise.all(
      [
        "crm_member_profiles",
        "crm_membership_tiers",
        "crm_xp_rules",
        "crm_rewards",
        "crm_collectible_avatars",
        "crm_redemptions",
        "crm_external_events",
      ].map((table) => countTable(db, table))
    );
  const schemaReady = [memberCount, tierCount, xpRuleCount, rewardCount, avatarCount, redemptionCount, eventCount].every(
    (item) => item.ready
  );

  const topLoyalMembers = await topCustomersBy(db, "total_xp");
  const topTransactionSpenders = await topCustomersBy(db, "total_spent");
  const topArk = await topArkSpenders(db);

  const { count: posMemberFallbackCount, error: posMemberFallbackError } = await db
    .from("pos_customers")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .gt("total_xp", 0);

  const activity = schemaReady ? await recentXpActivity(db) : [];
  if (posMemberFallbackError) throw posMemberFallbackError;

  return {
    data: {
      stats: {
        totalCustomers: totalCustomers ?? 0,
        totalMembers: schemaReady ? memberCount.count : (posMemberFallbackCount ?? 0),
        cardMembers: toNumber(memberSummary?.card_members),
        registeredMembers: toNumber(memberSummary?.registered_members),
        arkOutstanding: toNumber(memberSummary?.ark_outstanding),
        tierCount: tierCount.count,
        xpRuleCount: xpRuleCount.count,
        rewardCount: rewardCount.count,
        avatarCount: avatarCount.count,
        redemptionCount: redemptionCount.count,
        externalEventCount: eventCount.count,
      },
      topLoyalMembers,
      topTransactionSpenders,
      topArkSpenders: topArk,
      recentXpActivity: activity,
    },
    schemaReady,
  };
}
