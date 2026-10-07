import "server-only";
import { createPgClient } from "@/lib/pg/create-client";
import { formatTime } from "@/lib/format";
import {
  buildTrend,
  isRevenueOrder,
  summarizeSales,
  toNumber,
  topProducts,
  VOIDED_STATUSES,
  type DashboardItemRow,
  type DashboardOrderRow,
  type DashboardPeriod,
} from "@/lib/pos/dashboard-stats";

type Db = ReturnType<typeof createPgClient>;
type Range = { startDate: Date; endDate: Date; prevStart: Date; prevEnd: Date };

const VOIDED_STATUSES_SQL = `(${VOIDED_STATUSES.map((s) => `"${s}"`).join(",")})`;

type RecentOrderRow = {
  id: string;
  order_number?: string | null;
  total_amount?: number | string | null;
  status?: string | null;
  payment_status?: string | null;
  ordered_at: string;
  cashier_id?: string | null;
};

/**
 * 8 order terbaru. Nama kasir diresolve terpisah dari hris.employees per
 * cashier_id (embed alias lama gagal diam-diam dan membuat daftar kosong).
 */
async function loadRecentOrders(db: Db) {
  const { data, error } = await db
    .from("pos_orders")
    .select("id, order_number, total_amount, status, payment_status, ordered_at, cashier_id")
    .order("ordered_at", { ascending: false })
    .limit(8);
  if (error) console.error("[pos] dashboard recent orders:", error.message);
  const rows = (data ?? []) as RecentOrderRow[];

  const cashierIds = [...new Set(rows.map((order) => order.cashier_id).filter((id): id is string => Boolean(id)))];
  const cashierNameById = new Map<string, string>();
  if (cashierIds.length > 0) {
    const { data: cashierRows } = await db.from("employees").select("id, full_name").in("id", cashierIds);
    for (const row of (cashierRows ?? []) as Array<{ id: string; full_name?: string | null }>) {
      if (row.full_name) cashierNameById.set(String(row.id), row.full_name);
    }
  }
  return rows.map((order) => ({
    id: order.order_number || order.id,
    // "—" bila kasir tidak ter-resolve (mis. data lama ber-cashier dummy).
    cashier: cashierNameById.get(String(order.cashier_id || "")) || "—",
    total: toNumber(order.total_amount),
    status: order.status || "pending",
    payment_status: order.payment_status || "unpaid",
    time: formatTime(order.ordered_at),
  }));
}

/**
 * XP dicatat di crm_xp_ledger (loyalty engine); pos_xp_transactions hanya
 * data era lama. Keduanya dijumlah karena berasal dari era berbeda.
 */
async function loadXpRows(db: Db, startIso: string, endIso: string) {
  const [{ data: ledger }, { data: legacy }] = await Promise.all([
    db
      .from("crm_xp_ledger")
      .select("xp_delta, created_at")
      .eq("source_channel", "pos")
      .eq("direction", "earn")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    db.from("pos_xp_transactions").select("xp_earned, created_at").gte("created_at", startIso).lte("created_at", endIso),
  ]);
  return [
    ...((ledger ?? []) as Array<{ xp_delta?: unknown; created_at?: unknown }>).map((row) => ({
      xp_earned: toNumber(row.xp_delta),
      created_at: String(row.created_at),
    })),
    ...((legacy ?? []) as Array<{ xp_earned?: unknown; created_at?: unknown }>).map((row) => ({
      xp_earned: toNumber(row.xp_earned),
      created_at: String(row.created_at),
    })),
  ];
}

async function loadMemberLoyalty(db: Db) {
  const [{ count: membersWithXp }, { data: balances }, { data: loyal }] = await Promise.all([
    db.from("pos_customers").select("id", { count: "exact", head: true }).eq("is_active", true).gt("total_xp", 0),
    db.from("pos_customers").select("ark_coin_balance").eq("is_active", true),
    db
      .from("pos_customers")
      .select("id, name, membership_tier, total_xp, ark_coin_balance")
      .eq("is_active", true)
      .or("total_xp.gt.0,ark_coin_balance.gt.0")
      .order("total_xp", { ascending: false })
      .limit(5),
  ]);
  type MemberRow = {
    id: string;
    name?: string | null;
    membership_tier?: string | null;
    total_xp?: unknown;
    ark_coin_balance?: unknown;
  };
  return {
    membersWithXp: membersWithXp ?? 0,
    totalArkBalance: ((balances ?? []) as MemberRow[]).reduce((sum, row) => sum + toNumber(row.ark_coin_balance), 0),
    topLoyalMembers: ((loyal ?? []) as MemberRow[]).map((member) => ({
      id: member.id,
      name: member.name || "Member",
      membershipTier: member.membership_tier || "regular",
      totalXp: toNumber(member.total_xp),
      arkBalance: toNumber(member.ark_coin_balance),
    })),
  };
}

/** Statistik dashboard POS untuk satu periode (format respons sama dengan versi lama). */
export async function loadPosDashboard(period: DashboardPeriod, range: Range) {
  const db = createPgClient();
  const startIso = range.startDate.toISOString();
  const endIso = range.endDate.toISOString();

  const [{ data: periodData }, { data: prevData }, { count: prevOrders }, { data: itemData }] = await Promise.all([
    db
      .from("pos_orders")
      .select("id, total_amount, cashier_id, ordered_at, ark_coins_used, payment_method, status, payment_status")
      .gte("ordered_at", startIso)
      .lte("ordered_at", endIso),
    db
      .from("pos_orders")
      .select("total_amount")
      .eq("payment_status", "paid")
      .not("status", "in", VOIDED_STATUSES_SQL)
      .gte("ordered_at", range.prevStart.toISOString())
      .lte("ordered_at", range.prevEnd.toISOString()),
    db
      .from("pos_orders")
      .select("*", { count: "exact", head: true })
      .eq("payment_status", "paid")
      .not("status", "in", VOIDED_STATUSES_SQL)
      .gte("ordered_at", range.prevStart.toISOString())
      .lte("ordered_at", range.prevEnd.toISOString()),
    db
      .from("pos_order_items")
      .select("order_id, product_id, product_name, quantity, total_amount")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);
  const periodOrders = (periodData ?? []) as DashboardOrderRow[];
  const paidOrders = periodOrders.filter(isRevenueOrder);
  const previousRevenue = ((prevData ?? []) as Array<{ total_amount?: unknown }>).reduce(
    (sum, row) => sum + toNumber(row.total_amount),
    0
  );

  // "ARK Masuk": koin yang MASUK ke wallet member (top-up + bonus) pada periode ini.
  const { data: arkCreditRows } = await db
    .from("pos_wallet_transactions")
    .select("amount, type, created_at")
    .in("type", ["topup", "topup_bonus", "bonus"])
    .gte("created_at", startIso)
    .lte("created_at", endIso);
  const xpRows = await loadXpRows(db, startIso, endIso);
  const [recentOrders, loyalty] = await Promise.all([loadRecentOrders(db), loadMemberLoyalty(db)]);

  return {
    stats: summarizeSales(periodOrders, { revenue: previousRevenue, orders: prevOrders || 0 }),
    topProducts: topProducts((itemData ?? []) as DashboardItemRow[], new Set(paidOrders.map((o) => String(o.id)))),
    recentOrders,
    arkXp: {
      totalArkUsed: paidOrders.reduce((sum, order) => sum + toNumber(order.ark_coins_used), 0),
      totalArkEarned: ((arkCreditRows ?? []) as Array<{ amount?: unknown }>).reduce(
        (sum, row) => sum + Math.abs(toNumber(row.amount)),
        0
      ),
      totalXpEarned: xpRows.reduce((sum, row) => sum + row.xp_earned, 0),
      arkPaymentOrders: paidOrders.filter(
        (order) => order.payment_method === "ark_coin" || toNumber(order.ark_coins_used) > 0
      ).length,
      membersWithXp: loyalty.membersWithXp,
      totalArkBalance: loyalty.totalArkBalance,
    },
    trend: buildTrend({ period, startDate: range.startDate, endDate: range.endDate, paidOrders, xpRows }),
    topLoyalMembers: loyalty.topLoyalMembers,
  };
}
