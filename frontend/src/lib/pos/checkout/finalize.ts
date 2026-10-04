// Efek samping setelah anak-order lunas (di luar transaksi): tiket dapur,
// statistik member, XP CRM, dan jurnal akuntansi per anak-order.
import { createPgClient } from "@/lib/pg/create-client";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";
import { AccountingPostError } from "@/lib/pos/accounting-posting";
import { buildKitchenPrintJobs, type KitchenPrintItem } from "@/lib/pos/kitchen-station";
import { shouldSyncCustomerStatsOnFinalize, toNumber } from "./rules";

type PgClient = ReturnType<typeof createPgClient>;

type FinalizedOrderRow = {
  id: string;
  order_number: string | null;
  queue_number: string | null;
  order_type: string | null;
  table_id: string | null;
  total_amount: string | number | null;
  warehouse_id: string | null;
};

type FinalizedItemRow = KitchenPrintItem & { order_id: string };

async function insertKitchenTickets(
  db: PgClient,
  orders: FinalizedOrderRow[],
  itemsByOrder: Map<string, FinalizedItemRow[]>
) {
  for (const order of orders) {
    const childItems = itemsByOrder.get(String(order.id)) || [];
    const { data: existingJobs } = await db
      .from("pos_print_jobs")
      .select("id")
      .eq("order_id", String(order.id))
      .limit(1);
    if (existingJobs && existingJobs.length > 0) continue;
    const printJobs = buildKitchenPrintJobs(order as unknown as Record<string, unknown>, childItems);
    if (printJobs.length === 0) continue;
    const { error: printJobError } = await db.from("pos_print_jobs").insert(printJobs);
    const duplicate =
      printJobError?.code === "23505" || /duplicate key|unique/i.test(printJobError?.message ?? "");
    if (
      printJobError &&
      !duplicate &&
      printJobError.code !== "42P01" &&
      printJobError.code !== "PGRST205"
    ) {
      console.warn("[pos] mixed checkout print jobs:", printJobError.message);
    }
  }
}

/**
 * XP CRM + jurnal akuntansi per anak-order. Mengembalikan total XP supaya
 * struk checkout bisa mencetak "XP didapat" (EPIC-041 task 2).
 */
async function awardXpAndPostJournals(
  db: PgClient,
  orders: FinalizedOrderRow[],
  itemsByOrder: Map<string, FinalizedItemRow[]>,
  input: { customerId?: string | null; sessionUserId: string; paymentMethod: string; branchId?: string | null }
): Promise<number> {
  let xpAwarded = 0;
  for (const order of orders) {
    const childItems = itemsByOrder.get(String(order.id)) || [];
    const crmXp = await awardCrmXpForPosOrder(db, {
      orderId: String(order.id),
      customerId: input.customerId || null,
      totalAmount: toNumber(order.total_amount),
      items: childItems,
      outletId: input.branchId,
      paymentMethod: input.paymentMethod,
    });
    xpAwarded += Number(crmXp?.xpAwarded) || 0;
    try {
      const { postPosSaleAccountingJournals } = await import("@/lib/pos/accounting-posting");
      await postPosSaleAccountingJournals({
        db,
        orderId: String(order.id),
        userId: input.sessionUserId,
        paymentMethod: input.paymentMethod,
      });
    } catch (err) {
      if (err instanceof AccountingPostError) {
        console.error(`[pos] accounting post failed: order=${order.id}:`, err);
      } else {
        throw err;
      }
    }
  }
  return xpAwarded;
}

export async function finalizePaidChildren(input: {
  orderIds: string[];
  customerId?: string | null;
  sessionUserId: string;
  paymentMethod: string;
  branchId?: string | null;
  alreadyHadChildren?: boolean;
}): Promise<{ xpAwarded: number }> {
  if (input.orderIds.length === 0) return { xpAwarded: 0 };
  const db = createPgClient();
  const { data: orderRows } = await db
    .from("pos_orders")
    .select("id, order_number, queue_number, order_type, table_id, total_amount, warehouse_id")
    .in("id", input.orderIds);
  const { data: itemRows } = await db
    .from("pos_order_items")
    .select(
      "id, order_id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, total_amount, station"
    )
    .in("order_id", input.orderIds);

  const orders = (orderRows || []) as FinalizedOrderRow[];
  const itemsByOrder = new Map<string, FinalizedItemRow[]>();
  for (const row of (itemRows || []) as FinalizedItemRow[]) {
    const list = itemsByOrder.get(String(row.order_id)) ?? [];
    list.push(row);
    itemsByOrder.set(String(row.order_id), list);
  }

  await insertKitchenTickets(db, orders, itemsByOrder);

  if (
    input.customerId &&
    shouldSyncCustomerStatsOnFinalize({ alreadyHadChildren: Boolean(input.alreadyHadChildren) })
  ) {
    const total = orders.reduce((sum, order) => sum + toNumber(order.total_amount), 0);
    await syncPosCustomerOrderStats(db, input.customerId, total);
  }

  return { xpAwarded: await awardXpAndPostJournals(db, orders, itemsByOrder, input) };
}

/** Total XP member SETELAH award, untuk baris "Total XP" di struk. */
export async function loadMemberTotalXp(db: PgClient, customerId: string): Promise<number | null> {
  const { data: xpCustomer } = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", customerId)
    .maybeSingle();
  const totalXp = Number((xpCustomer as { total_xp?: unknown } | null)?.total_xp);
  return Number.isFinite(totalXp) ? totalXp : null;
}
