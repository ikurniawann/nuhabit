import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/pg/types";
import {
  adjustMemberXp,
  awardChallengeXp,
  awardCrmXpForPosOrder,
  awardCrmXpForSplitPayment,
  awardCrmXpForTopup,
  reverseCrmXpForVoidedOrders,
  syncPosCustomerOrderStats,
} from "./loyalty-engine";

// Karakterisasi alur tulis XP (ledger, profil, tier) di atas db palsu yang
// meniru query builder PostgREST-like (from/select/eq/in/order/limit/insert/update).

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in"; value: unknown };

function createFakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );
  let nextId = 1;

  function matches(row: Row, filters: Filter[]) {
    return filters.every((f) =>
      f.op === "eq" ? row[f.col] === f.value : (f.value as unknown[]).includes(row[f.col])
    );
  }

  function withJoins(row: Row, columns: string): Row {
    if (!columns.includes("tier:crm_membership_tiers")) return { ...row };
    const tier = (tables.crm_membership_tiers ?? []).find((t) => t.id === row.tier_id) ?? null;
    return { ...row, tier };
  }

  function from(table: string) {
    let op: "select" | "insert" | "update" = "select";
    let columns = "*";
    let payload: Row | null = null;
    let order: { col: string; ascending: boolean } | null = null;
    const filters: Filter[] = [];

    function run(mode: "many" | "maybe" | "single") {
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        const row = { id: `id-${nextId++}`, ...payload } as Row;
        const key = row.idempotency_key;
        if (key && rows.some((r) => r.idempotency_key === key)) {
          return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
        }
        rows.push(row);
        return Promise.resolve({ data: mode === "many" ? [row] : withJoins(row, columns), error: null });
      }
      if (op === "update") {
        const hit = rows.filter((r) => matches(r, filters));
        hit.forEach((r) => Object.assign(r, payload));
        return Promise.resolve({ data: hit, error: null });
      }
      let hit = rows.filter((r) => matches(r, filters)).map((r) => withJoins(r, columns));
      if (order) {
        const { col, ascending } = order;
        hit = [...hit].sort((a, b) => (Number(a[col]) - Number(b[col])) * (ascending ? 1 : -1));
      }
      if (mode === "many") return Promise.resolve({ data: hit, error: null });
      return Promise.resolve({ data: hit[0] ?? null, error: null });
    }

    const builder = {
      select(cols = "*") {
        if (op === "select") columns = cols;
        return builder;
      },
      insert(values: Row) {
        op = "insert";
        payload = values;
        return builder;
      },
      update(values: Row) {
        op = "update";
        payload = values;
        return builder;
      },
      eq(col: string, value: unknown) {
        filters.push({ col, op: "eq", value });
        return builder;
      },
      in(col: string, value: unknown[]) {
        filters.push({ col, op: "in", value });
        return builder;
      },
      order(col: string, opts: { ascending: boolean }) {
        order = { col, ascending: opts.ascending };
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle: () => run("maybe"),
      single: () => run("single"),
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return run("many").then(resolve, reject);
      },
    };
    return builder;
  }

  return { db: { from } as unknown as DbClient, tables };
}

const TIERS = [
  { id: "t-regular", code: "regular", name: "Regular", rank: 0, min_lifetime_xp: 0, xp_multiplier: 1, is_active: true },
  { id: "t-silver", code: "silver", name: "Silver", rank: 2, min_lifetime_xp: 100, xp_multiplier: 2, is_active: true },
];

function baseSeed(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    crm_settings: [
      { key: "default_company_id", value: "co-1" },
      { key: "default_branch_id", value: "br-1" },
    ],
    crm_membership_tiers: TIERS,
    pos_customers: [{ id: "c1", phone: "0812-3456-7890", membership_tier: "regular", total_xp: 90, total_spent: 0, visit_count: 0 }],
    pos_orders: [{ id: "order-uuid-1234", order_number: "A-001" }],
    pos_products: [],
    crm_xp_rules: [],
    crm_xp_ledger: [],
    crm_member_profiles: [],
    pos_loyalty_settings: [
      {
        is_active: true,
        spend_xp_enabled: true,
        spend_xp_amount_step: 1000,
        spend_xp_min: 0,
        topup_xp_enabled: true,
        topup_xp_mode: "per_amount",
        topup_xp_value: 1,
        topup_xp_amount_step: 10_000,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("awardCrmXpForPosOrder", () => {
  it("tanpa customer dilewati", async () => {
    const { db } = createFakeDb(baseSeed());
    const result = await awardCrmXpForPosOrder(db, { orderId: "o", totalAmount: 1, items: [] });
    expect(result).toEqual({ status: "skipped", xpAwarded: 0, reason: "no_customer" });
  });

  it("bayar non-ARK: XP belanja dilewati", async () => {
    const { db, tables } = createFakeDb(baseSeed());
    const result = await awardCrmXpForPosOrder(db, {
      orderId: "order-uuid-1234",
      customerId: "c1",
      totalAmount: 50_000,
      items: [],
      paymentMethod: "cash",
    });
    expect(result).toEqual({ status: "skipped", xpAwarded: 0, reason: "non_ark_payment" });
    expect(tables.crm_xp_ledger).toHaveLength(0);
  });

  it("ARK Coin tanpa aturan: XP dari pengaturan loyalti, enrol profil, naik tier, idempoten", async () => {
    const { db, tables } = createFakeDb(baseSeed());
    const payload = {
      orderId: "order-uuid-1234",
      customerId: "c1",
      totalAmount: 25_000,
      items: [{ product_id: "p-none", quantity: 1, unit_price: 25_000 }],
      paymentMethod: "ark_coin",
    };
    const result = await awardCrmXpForPosOrder(db, payload);
    expect(result.status).toBe("posted");
    expect(result.xpAwarded).toBe(25);

    const [ledger] = tables.crm_xp_ledger;
    expect(ledger).toMatchObject({
      customer_id: "c1",
      direction: "earn",
      source_channel: "pos",
      source_type: "order_amount_settings",
      company_id: "co-1",
      branch_id: "br-1",
      xp_delta: 25,
      lifetime_before: 90,
      lifetime_after: 115,
      reference_table: "pos_orders",
      reference_id: "order-uuid-1234",
      idempotency_key: "pos:order:order-uuid-1234:order_amount",
      description: "XP transaksi POS — order #A-001 (Rp25.000)",
    });

    const [profile] = tables.crm_member_profiles;
    expect(profile).toMatchObject({ customer_id: "c1", member_code: "ARK-1234567890", lifetime_xp: 115, tier_id: "t-silver" });
    expect(tables.pos_customers[0]).toMatchObject({ total_xp: 115, membership_tier: "silver" });

    const again = await awardCrmXpForPosOrder(db, payload);
    expect(again.status).toBe("duplicate");
    expect(tables.crm_xp_ledger).toHaveLength(1);
  });

  it("aturan produk + multiplier tier + bonus XP produk", async () => {
    const { db, tables } = createFakeDb(
      baseSeed({
        pos_customers: [{ id: "c1", membership_tier: "silver", total_xp: 200 }],
        crm_member_profiles: [{ id: "m1", customer_id: "c1", tier_id: "t-silver", lifetime_xp: 200, loyalty_score: 200 }],
        crm_xp_rules: [
          {
            id: "rule-p1",
            source_channel: "pos",
            source_type: "product",
            source_id: "p1",
            outlet_scope: "all",
            outlet_id: null,
            xp_mode: "per_item",
            xp_value: 5,
            amount_step: 1,
            min_amount: 0,
            max_xp_per_event: null,
            tier_multiplier_enabled: true,
            priority: 1,
            starts_at: null,
            ends_at: null,
            is_active: true,
          },
        ],
        pos_products: [{ id: "p1", xp_points: 0, bonus_xp: 3 }],
      })
    );
    const result = await awardCrmXpForPosOrder(db, {
      orderId: "order-uuid-1234",
      customerId: "c1",
      totalAmount: 40_000,
      outletId: "outlet-9",
      items: [{ product_id: "p1", quantity: 2, total_amount: 40_000 }],
      paymentMethod: "ark_coin",
    });
    // 5 × 2 item × multiplier silver 2 = 20, bonus 3 × 2 = 6 (tanpa multiplier).
    expect(result.status).toBe("posted");
    expect(result.xpAwarded).toBe(26);
    const keys = tables.crm_xp_ledger.map((row) => row.idempotency_key);
    expect(keys).toEqual(["pos:order:order-uuid-1234:product_bonus", "pos:order:order-uuid-1234:product:p1:0"]);
    expect(tables.crm_xp_ledger[0]).toMatchObject({
      source_type: "product_bonus",
      branch_id: "outlet-9",
      description: "Bonus XP produk — order #A-001",
    });
    expect(tables.crm_xp_ledger[1]).toMatchObject({ rule_id: "rule-p1", xp_delta: 20, outlet_id: "outlet-9" });
    expect(tables.pos_customers[0].total_xp).toBe(226);
  });
});

describe("awardCrmXpForSplitPayment", () => {
  it("menulis ledger split dengan label order", async () => {
    const { db, tables } = createFakeDb(baseSeed());
    const result = await awardCrmXpForSplitPayment(db, {
      orderId: "order-uuid-1234",
      splitId: "split-1",
      customerId: "c1",
      totalAmount: 5_000,
      paymentMethod: "ark_coin",
    });
    expect(result).toMatchObject({ status: "posted", xpAwarded: 5 });
    expect(tables.crm_xp_ledger[0]).toMatchObject({
      source_type: "split_payment",
      reference_table: "pos_order_splits",
      idempotency_key: "pos:split:split-1:order_amount",
      description: "XP split payment POS — order #A-001 (Rp5.000)",
    });
  });
});

describe("awardCrmXpForTopup", () => {
  it("XP topup per kelipatan", async () => {
    const { db, tables } = createFakeDb(baseSeed());
    const result = await awardCrmXpForTopup(db, { customerId: "c1", topupAmountIdr: 55_000, transactionId: "tx1" });
    expect(result).toMatchObject({ status: "posted", xpAwarded: 5 });
    expect(tables.crm_xp_ledger[0]).toMatchObject({
      idempotency_key: "pos:topup:tx1",
      description: "XP topup ARK — Rp55.000",
    });
  });
});

describe("awardChallengeXp", () => {
  it("XP nominal tanpa multiplier tier, sekali per challenge", async () => {
    const { db, tables } = createFakeDb(
      baseSeed({
        crm_member_profiles: [{ id: "m1", customer_id: "c1", tier_id: "t-silver", lifetime_xp: 90, loyalty_score: 90 }],
      })
    );
    const input = { customerId: "c1", challengeId: "ch1", challengeTitle: "Ngopi 5x", xpAmount: 12.7 };
    expect(await awardChallengeXp(db, input)).toMatchObject({ status: "posted", xpAwarded: 12 });
    expect(await awardChallengeXp(db, input)).toMatchObject({ status: "duplicate", xpAwarded: 0 });
    expect(tables.crm_xp_ledger[0]).toMatchObject({
      source_type: "challenge",
      reference_table: "challenges",
      idempotency_key: "challenge:ch1:c1",
      description: "Hadiah challenge: Ngopi 5x",
    });
    expect(tables.pos_customers[0].total_xp).toBe(102);
  });
});

describe("reverseCrmXpForVoidedOrders", () => {
  it("menarik XP earn order sekali, clamp ≥ 0, tier bisa turun", async () => {
    const { db, tables } = createFakeDb(
      baseSeed({
        pos_customers: [{ id: "c1", total_xp: 120, membership_tier: "silver" }],
        crm_member_profiles: [{ id: "m1", customer_id: "c1", tier_id: "t-silver", lifetime_xp: 120 }],
        crm_xp_ledger: [
          { id: "l1", customer_id: "c1", member_id: "m1", direction: "earn", reference_table: "pos_orders", reference_id: "o1", xp_delta: 15, idempotency_key: "a" },
          { id: "l2", customer_id: "c1", member_id: "m1", direction: "earn", reference_table: "pos_orders", reference_id: "o1", xp_delta: 10, idempotency_key: "b" },
        ],
      })
    );
    expect(await reverseCrmXpForVoidedOrders(db, { orderIds: ["o1"], voidReason: "salah input" })).toEqual({ xpReversed: 25 });
    const reverse = tables.crm_xp_ledger.find((row) => row.direction === "reverse");
    expect(reverse).toMatchObject({
      xp_delta: -25,
      lifetime_before: 120,
      lifetime_after: 95,
      idempotency_key: "pos:order:o1:void_reverse",
      description: "Pembatalan XP — void order (salah input)",
    });
    expect(tables.pos_customers[0]).toMatchObject({ total_xp: 95, membership_tier: "regular" });
    expect(await reverseCrmXpForVoidedOrders(db, { orderIds: ["o1"] })).toEqual({ xpReversed: 0 });
  });
});

describe("adjustMemberXp", () => {
  it("pengurangan dijepit ke saldo, requestId ganda = duplicate", async () => {
    const { db, tables } = createFakeDb(baseSeed());
    const input = { customerId: "c1", delta: -500, reason: "koreksi", actorId: "u1", requestId: "req-1" };
    expect(await adjustMemberXp(db, input)).toEqual({ status: "posted", xpDelta: -90, totalXp: 0 });
    expect(tables.crm_xp_ledger[0]).toMatchObject({
      direction: "adjust",
      source_type: "admin_adjustment",
      xp_delta: -90,
      description: "Penyesuaian admin: koreksi",
      metadata: { reason: "koreksi", actor_id: "u1", requested_delta: -500 },
    });
    expect(await adjustMemberXp(db, input)).toEqual({ status: "duplicate", xpDelta: 0, totalXp: 0 });
    expect(await adjustMemberXp(db, { ...input, requestId: "req-2", delta: 0 })).toEqual({
      status: "skipped",
      xpDelta: 0,
      totalXp: 0,
    });
  });
});

describe("syncPosCustomerOrderStats", () => {
  it("menambah total belanja dan kunjungan", async () => {
    const { db, tables } = createFakeDb(baseSeed());
    await syncPosCustomerOrderStats(db, "c1", 30_000);
    expect(tables.pos_customers[0]).toMatchObject({ total_spent: 30_000, visit_count: 1 });
  });
});
