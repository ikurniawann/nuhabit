// Karakterisasi alur transaksional checkout gabungan (uang). Setiap skenario
// merekam SELURUH panggilan DB (SQL dinormalisasi spasi + parameter, batas
// transaksi BEGIN/COMMIT/ROLLBACK, panggilan shim PostgREST, efek samping
// loyalty/akuntansi/stok) lalu dibandingkan dengan snapshot. Refactor yang
// mengubah urutan, SQL, parameter atau batas transaksi akan gagal di sini.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Record<string, unknown>[];
type SqlRule = { match: RegExp; rows: Rows | ((params: unknown[]) => Rows) };
type PgResult = { data?: unknown; error?: { message?: string; code?: string } | null };

const trace: unknown[] = [];
let sqlRules: SqlRule[] = [];
let pgResponder: (table: string, ops: unknown[][]) => PgResult = () => ({ data: null, error: null });
let rpcResponder: (name: string, args: unknown) => PgResult = () => ({ data: null, error: null });
let merchClaim: { ok: true; claims: unknown[] } | { ok: false; reason: string; status: number } = {
  ok: true,
  claims: [],
};
let orderSeq = 0;

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    trace.push({ sql: norm(sql), params });
    for (const rule of sqlRules) {
      if (rule.match.test(norm(sql))) {
        return { rows: typeof rule.rows === "function" ? rule.rows(params) : rule.rows };
      }
    }
    return { rows: [] };
  }),
};

function pgBuilder(table: string) {
  const ops: unknown[][] = [];
  const settle = () => {
    trace.push({ pg: table, ops });
    return pgResponder(table, ops);
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "neq", "limit", "insert", "update"]) {
    builder[method] = (...args: unknown[]) => {
      ops.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    ops.push(["maybeSingle"]);
    return Promise.resolve(settle());
  };
  builder.then = (resolve: (value: PgResult) => unknown, reject: (err: unknown) => unknown) =>
    Promise.resolve(settle()).then(resolve, reject);
  return builder;
}

const fakeDb = {
  from: (table: string) => pgBuilder(table),
  rpc: async (name: string, args: unknown) => {
    trace.push({ rpc: name, args });
    return rpcResponder(name, args);
  },
};

vi.mock("@/lib/db", () => ({
  withTransaction: async (fn: (client: typeof fakeClient) => Promise<unknown>) => {
    trace.push("BEGIN");
    try {
      const result = await fn(fakeClient);
      trace.push("COMMIT");
      return result;
    } catch (error) {
      trace.push("ROLLBACK");
      throw error;
    }
  },
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => fakeDb }));
vi.mock("@/lib/crm/server", () => ({
  getCrmDefaultVenue: async () => ({ companyId: "co-venue", branchId: "br-venue" }),
}));
vi.mock("@/lib/crm/loyalty-engine", () => ({
  awardCrmXpForPosOrder: async (_db: unknown, input: Record<string, unknown>) => {
    trace.push({ awardXp: { ...input, items: (input.items as unknown[]).length } });
    return { xpAwarded: 7 };
  },
  syncPosCustomerOrderStats: async (_db: unknown, customerId: string, total: number) => {
    trace.push({ syncStats: { customerId, total } });
  },
}));
vi.mock("@/lib/pos/accounting-posting", () => ({
  AccountingPostError: class AccountingPostError extends Error {},
  postPosSaleAccountingJournals: async (input: { orderId: string; userId: string; paymentMethod: string }) => {
    trace.push({ journal: { orderId: input.orderId, userId: input.userId, paymentMethod: input.paymentMethod } });
  },
}));
vi.mock("@/lib/pos/merchandise-stock", () => ({
  claimMerchandiseStock: async (_db: unknown, items: unknown[]) => {
    trace.push({ claimMerch: items.length });
    return merchClaim;
  },
  restoreMerchandiseStock: async (_db: unknown, claims: unknown[]) => {
    trace.push({ restoreMerch: claims });
  },
}));
vi.mock("@/lib/pos/purchasing-sync", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/purchasing-sync")>()),
  loadPosProductCostMap: async (_db: unknown, ids: string[]) => {
    trace.push({ costMap: ids });
    return new Map(ids.map((id) => [id, { cost_price: 1000 }]));
  },
}));
const xendit = { paid: true };
vi.mock("@/lib/payments/xendit", () => ({
  loadActiveXenditConfig: async () => ({ secretKey: "sk" }),
  getXenditQrCode: async (_key: string, id: string) => {
    trace.push({ xenditGet: id });
    return { id, status: xendit.paid ? "COMPLETED" : "ACTIVE" };
  },
  getXenditQrCodeByReferenceId: async (_key: string, ref: string) => {
    trace.push({ xenditByRef: ref });
    return { id: "qr-from-ref", status: xendit.paid ? "COMPLETED" : "ACTIVE" };
  },
  getXenditQrPayments: async (_key: string, id: string) => {
    trace.push({ xenditPayments: id });
    return [];
  },
  isXenditQrPaid: (remote: { status?: string }) => remote.status === "COMPLETED",
}));

import {
  cancelUnpaidChildlessCheckout,
  completeMixedCheckout,
  createMixedCheckout,
  type CreateMixedCheckoutInput,
} from "@/lib/pos/create-mixed-checkout";

const numberingRules: SqlRule[] = [
  { match: /AS prefix$/, rows: [{ prefix: "CHK-20261004" }] },
  { match: /AS seq FROM pos\.pos_checkouts/, rows: [{ seq: 3 }] },
  { match: /generate_order_number\(\)/, rows: () => [{ value: `ORD-${++orderSeq}` }] },
  { match: /generate_queue_number/, rows: [{ value: "A07" }] },
  {
    match: /^INSERT INTO pos\.pos_checkouts/,
    rows: (params) => [{ id: "chk-new", checkout_number: params[0], queue_number: params[1] }],
  },
];

const items = [
  { product_id: "p-kopi", product_name: "Kopi", quantity: 2, unit_price: 20000, station: "bar" },
  { product_id: "p-roti", product_name: "Roti", quantity: 1, unit_price: 15000, modifier_price_adjustment: 2000 },
  { product_id: "p-teh", product_name: "Teh", quantity: 3, unit_price: 8000, variant_price_adjustment: 1000 },
];
const warehouseByProduct = new Map<string, string | null>([
  ["p-kopi", "wh-bar"],
  ["p-roti", "wh-bakery"],
  ["p-teh", "wh-bar"],
]);

function baseInput(overrides: Partial<CreateMixedCheckoutInput> = {}): CreateMixedCheckoutInput {
  return {
    items,
    warehouseByProduct,
    orderType: "dine_in",
    customerId: "cust-1",
    cashierId: "kasir-1",
    serverId: "srv-1",
    guestCount: 2,
    discountAmount: 5000,
    discountReason: "Diskon kasir",
    taxAmount: 8000,
    serviceChargeAmount: 4000,
    otherChargesAmount: 0,
    chargesBreakdown: [{ name: "PB1", amount: 8000 }],
    paymentMethod: "cash",
    amountPaid: 100000,
    notes: "catatan",
    specialRequests: "tanpa gula",
    branchId: "br-1",
    companyId: "co-1",
    shiftId: "shift-1",
    sessionUserId: "user-1",
    paymentMethodCode: "cash",
    paymentMethodName: "Tunai",
    ...overrides,
  };
}

function defaultPgResponder(table: string, ops: unknown[][]): PgResult {
  const first = ops[0]?.[0];
  if (table === "pos_orders" && first === "select") {
    return {
      data: [
        { id: "uuid-1", order_number: "ORD-1", queue_number: "A07", order_type: "dine_in", table_id: null, total_amount: 60000, warehouse_id: "wh-bar" },
        { id: "uuid-2", order_number: "ORD-2", queue_number: "A07", order_type: "dine_in", table_id: null, total_amount: 20000, warehouse_id: "wh-bakery" },
      ],
      error: null,
    };
  }
  if (table === "pos_order_items" && first === "select") {
    return {
      data: [
        { id: "it-1", order_id: "uuid-1", product_id: "p-kopi", product_name: "Kopi", quantity: 2, unit_price: 20000, total_amount: 40000, station: "bar" },
        { id: "it-2", order_id: "uuid-2", product_id: "p-roti", product_name: "Roti", quantity: 1, unit_price: 17000, total_amount: 17000, station: "kitchen" },
      ],
      error: null,
    };
  }
  if (table === "pos_print_jobs" && first === "select") return { data: [], error: null };
  if (table === "pos_customers") return { data: { total_xp: 140 }, error: null };
  return { data: null, error: null };
}

beforeEach(() => {
  trace.length = 0;
  sqlRules = [...numberingRules];
  pgResponder = defaultPgResponder;
  rpcResponder = () => ({ data: 50000, error: null });
  merchClaim = { ok: true, claims: [] };
  orderSeq = 0;
  xendit.paid = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T05:00:00.000Z"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** randomUUID asli → "uuid-N" menurut urutan kemunculan supaya snapshot stabil. */
function stableUuids(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === "string" && UUID_RE.test(value)) {
    if (!seen.has(value)) seen.set(value, `uuid-${seen.size + 1}`);
    return seen.get(value);
  }
  if (Array.isArray(value)) return value.map((entry) => stableUuids(entry, seen));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stableUuids(entry, seen)]));
  }
  return value;
}

async function run<T>(fn: () => Promise<T>) {
  try {
    return stableUuids({ result: await fn(), trace: [...trace] });
  } catch (error) {
    return stableUuids({
      error: { name: (error as Error).name, message: (error as Error).message, status: (error as { status?: number }).status },
      trace: [...trace],
    });
  }
}

describe("createMixedCheckout (karakterisasi)", () => {
  it("bayar tunai multi-stall: checkout + anak + item + riwayat + katalog, lalu finalisasi", async () => {
    merchClaim = { ok: true, claims: [{ productId: "p-roti", qty: 1 }] };
    expect(await run(() => createMixedCheckout(baseInput()))).toMatchSnapshot();
  });

  it("QRIS belum dibayar: checkout unpaid tanpa anak", async () => {
    expect(
      await run(() => createMixedCheckout(baseInput({ paymentMethod: "qris", amountPaid: 0, customerId: null })))
    ).toMatchSnapshot();
  });

  it("open bill meja tanpa checkout lama: checkout baru + anak pending (forceInsertChildren)", async () => {
    expect(
      await run(() =>
        createMixedCheckout(
          baseInput({ tableId: "tbl-1", paymentStatus: "unpaid", amountPaid: 0, forceInsertChildren: true })
        )
      )
    ).toMatchSnapshot();
  });

  it("open bill meja dengan checkout unpaid: item ditambahkan ke anak lama dan anak baru", async () => {
    sqlRules.unshift(
      {
        match: /FROM pos\.pos_checkouts WHERE table_id = \$1/,
        rows: [
          {
            id: "chk-old",
            checkout_number: "CHK-20261004-0001",
            queue_number: "A01",
            payment_status: "unpaid",
            payment_method: "cash",
            company_id: "co-1",
            branch_id: "br-1",
            table_id: "tbl-1",
            customer_id: "cust-1",
            cashier_id: "kasir-0",
            shift_id: "shift-0",
            notes: null,
            cart_snapshot: JSON.stringify({ items: [{ product_id: "p-old" }], warehouseByProduct: { "p-old": "wh-bar" } }),
          },
        ],
      },
      { match: /^SELECT id, warehouse_id FROM pos\.pos_orders/, rows: [{ id: "ord-bar-old", warehouse_id: "wh-bar" }] }
    );
    expect(
      await run(() =>
        createMixedCheckout(
          baseInput({ tableId: "tbl-1", paymentStatus: "unpaid", amountPaid: 0, reuseUnpaidTableCheckout: true })
        )
      )
    ).toMatchSnapshot();
  });

  it("lanjutkan checkout eksplisit yang tidak ada → galat 'Open bill tidak ditemukan'", async () => {
    expect(
      await run(() => createMixedCheckout(baseInput({ existingCheckoutId: "chk-x", paymentStatus: "unpaid", amountPaid: 0 })))
    ).toMatchSnapshot();
  });

  it("satu stall tanpa meja ditolak sebelum DB", async () => {
    expect(
      await run(() => createMixedCheckout(baseInput({ items: [items[0]!, items[2]!] })))
    ).toMatchSnapshot();
  });

  it("bayar penuh di meja dengan checkout unpaid ditolak", async () => {
    sqlRules.unshift({
      match: /FROM pos\.pos_checkouts WHERE table_id = \$1/,
      rows: [{ id: "chk-old", checkout_number: "CHK-1", queue_number: "A01", payment_status: "unpaid" }],
    });
    merchClaim = { ok: true, claims: [{ productId: "p-kopi", qty: 2 }] };
    expect(await run(() => createMixedCheckout(baseInput({ tableId: "tbl-1" })))).toMatchSnapshot();
  });

  it("ARK Coin: saldo dipotong lewat RPC, saldo akhir & XP dibawa ke hasil", async () => {
    expect(
      await run(() => createMixedCheckout(baseInput({ paymentMethod: "ark_coin", amountPaid: 0, arkCoinsUsed: 200000 })))
    ).toMatchSnapshot();
  });

  it("ARK Coin gagal: transaksi kompensasi menghapus checkout & anak, stok merch dipulihkan", async () => {
    rpcResponder = () => ({ data: null, error: { message: "Insufficient balance" } });
    merchClaim = { ok: true, claims: [{ productId: "p-kopi", qty: 2 }] };
    expect(
      await run(() => createMixedCheckout(baseInput({ paymentMethod: "ark_coin", amountPaid: 0, arkCoinsUsed: 200000 })))
    ).toMatchSnapshot();
  });

  it("validasi: promo, diskon baris, NFC, kurang bayar, ARK tanpa customer", async () => {
    const results = [
      await run(() => createMixedCheckout(baseInput({ promoCode: "HEMAT" }))),
      await run(() => createMixedCheckout(baseInput({ items: [{ ...items[0]!, discount_amount: 1000 }, items[1]!] }))),
      await run(() => createMixedCheckout(baseInput({ paymentMethod: "nfc_tab" }))),
      await run(() => createMixedCheckout(baseInput({ amountPaid: 1000 }))),
      await run(() => createMixedCheckout(baseInput({ paymentMethod: "ark_coin", customerId: null, arkCoinsUsed: 999999 }))),
      await run(() => createMixedCheckout(baseInput({ items: [{ product_id: "p-x", quantity: 1, unit_price: 1 }] }))),
    ];
    expect(results).toMatchSnapshot();
  });

  it("stok merch habis → galat dengan status dari klaim, tanpa transaksi", async () => {
    merchClaim = { ok: false, reason: "Stok habis", status: 409 };
    expect(await run(() => createMixedCheckout(baseInput()))).toMatchSnapshot();
  });
});

const storedCheckout = {
  id: "chk-9",
  checkout_number: "CHK-20261004-0009",
  queue_number: "A09",
  payment_status: "unpaid",
  payment_method: "cash",
  company_id: "co-1",
  branch_id: "br-1",
  table_id: null as string | null,
  customer_id: "cust-1",
  cashier_id: "kasir-1",
  shift_id: "shift-1",
  subtotal: 82000,
  discount_amount: 2000,
  tax_amount: 8000,
  service_charge_amount: 0,
  other_charges_amount: 0,
  total_amount: 88000,
  amount_paid: 0,
  change_amount: 0,
  notes: null,
  cart_snapshot: {
    items: [
      { product_id: "p-kopi", product_name: "Kopi", quantity: 2, unit_price: 20000, subtotal: 40000 },
      { product_id: "p-roti", product_name: "Roti", quantity: 1, unit_price: 42000, total_amount: 42000 },
    ],
    warehouseByProduct: { "p-kopi": "wh-bar", "p-roti": "wh-bakery" },
    orderType: "takeaway",
    guestCount: 1,
    notes: null,
    specialRequests: null,
    chargesBreakdown: [],
    cashierId: "kasir-1",
    serverId: null,
    sessionUserId: "user-snap",
    discountReason: null,
  },
  xendit_qr_id: "qr-9",
  xendit_external_id: "ext-9",
  payment_method_code: "qris",
  payment_method_name: "QRIS",
};

function completePg(children: Rows) {
  return (table: string, ops: unknown[][]): PgResult => {
    const first = ops[0]?.[0];
    if (table === "pos_orders" && first === "select" && ops[0]?.[1] === "id, total_amount, subtotal") {
      return { data: children, error: null };
    }
    if (table === "pos_checkouts" && first === "select") return { data: storedCheckout, error: null };
    return defaultPgResponder(table, ops);
  };
}

describe("completeMixedCheckout (karakterisasi)", () => {
  it("tanpa anak, tunai: settle checkout + sisip anak dalam satu transaksi, lalu finalisasi", async () => {
    pgResponder = completePg([]);
    sqlRules.unshift({ match: /FROM pos\.pos_checkouts WHERE id = \$1 FOR UPDATE$/, rows: [storedCheckout] });
    merchClaim = { ok: true, claims: [{ productId: "p-kopi", qty: 2 }] };
    expect(
      await run(() => completeMixedCheckout("chk-9", { paymentMethod: "cash", amountPaid: 100000 }))
    ).toMatchSnapshot();
  });

  it("tanpa anak, FOC: checkout & anak digratiskan, comp distempel", async () => {
    pgResponder = completePg([]);
    sqlRules.unshift({ match: /FROM pos\.pos_checkouts WHERE id = \$1 FOR UPDATE$/, rows: [storedCheckout] });
    expect(
      await run(() =>
        completeMixedCheckout("chk-9", {
          paymentMethod: "cash",
          amountPaid: 88000,
          paymentMethodCode: "foc",
          paymentMethodName: "FOC",
          compApproved: { id: "spv-1", name: "Supervisor" },
        })
      )
    ).toMatchSnapshot();
  });

  it("tanpa anak tapi anak muncul saat dikunci: pakai anak yang ada", async () => {
    pgResponder = completePg([]);
    sqlRules.unshift(
      { match: /FROM pos\.pos_checkouts WHERE id = \$1 FOR UPDATE$/, rows: [storedCheckout] },
      { match: /^SELECT id FROM pos\.pos_orders WHERE checkout_id = \$1$/, rows: [{ id: "ord-race" }] }
    );
    expect(
      await run(() => completeMixedCheckout("chk-9", { paymentMethod: "cash", amountPaid: 88000 }))
    ).toMatchSnapshot();
  });

  it("QRIS tersimpan dikonfirmasi ke Xendit sebelum settle; belum lunas → 409", async () => {
    pgResponder = completePg([]);
    sqlRules.unshift({ match: /FROM pos\.pos_checkouts WHERE id = \$1 FOR UPDATE$/, rows: [storedCheckout] });
    const paid = await run(() => completeMixedCheckout("chk-9", { paymentMethod: "qris", amountPaid: 88000 }));
    trace.length = 0;
    orderSeq = 0;
      xendit.paid = false;
    const unpaid = await run(() => completeMixedCheckout("chk-9", { paymentMethod: "qris", amountPaid: 88000 }));
    expect({ paid, unpaid }).toMatchSnapshot();
  });

  it("anak sudah ada (open bill): bayar lewat PostgREST, tender dibagi, finalisasi", async () => {
    pgResponder = completePg([
      { id: "ord-a", total_amount: 60000, subtotal: 55000 },
      { id: "ord-b", total_amount: 28000, subtotal: 27000 },
    ]);
    expect(
      await run(() => completeMixedCheckout("chk-9", { paymentMethod: "cash", amountPaid: 100000 }))
    ).toMatchSnapshot();
  });

  it("anak sudah ada + FOC", async () => {
    pgResponder = completePg([
      { id: "ord-a", total_amount: 60000, subtotal: 55000 },
      { id: "ord-b", total_amount: 28000, subtotal: null },
    ]);
    expect(
      await run(() =>
        completeMixedCheckout("chk-9", {
          paymentMethod: "cash",
          amountPaid: 88000,
          compApproved: { id: "spv-1", name: "Supervisor" },
        })
      )
    ).toMatchSnapshot();
  });

  it("checkout tidak ditemukan / tender tidak valid", async () => {
    pgResponder = (table, ops) =>
      table === "pos_checkouts" ? { data: null, error: null } : completePg([])(table, ops);
    const missing = await run(() => completeMixedCheckout("chk-x", { paymentMethod: "cash", amountPaid: 1 }));
    pgResponder = completePg([]);
    const ark = await run(() => completeMixedCheckout("chk-9", { paymentMethod: "ark_coin", amountPaid: 88000 }));
    const short = await run(() => completeMixedCheckout("chk-9", { paymentMethod: "cash", amountPaid: 1000 }));
    expect({ missing, ark, short }).toMatchSnapshot();
  });
});

describe("cancelUnpaidChildlessCheckout (karakterisasi)", () => {
  it("unpaid tanpa anak → ditandai cancelled dan dilepas dari meja", async () => {
    sqlRules.unshift(
      { match: /^SELECT id, payment_status, notes, table_id/, rows: [{ id: "chk-1", payment_status: "unpaid", notes: null, table_id: "tbl-1" }] },
      { match: /COUNT\(\*\)/, rows: [{ n: 0 }] }
    );
    expect(await run(() => cancelUnpaidChildlessCheckout("chk-1", { companyId: "co-1", branchId: "br-1" }))).toMatchSnapshot();
  });

  it("sudah cancelled → idempoten; punya anak → ditolak; tidak ada → 404", async () => {
    sqlRules.unshift({ match: /^SELECT id, payment_status, notes, table_id/, rows: [{ id: "chk-1", payment_status: "unpaid", notes: "cancelled", table_id: null }] });
    const already = await run(() => cancelUnpaidChildlessCheckout("chk-1"));
    trace.length = 0;
    sqlRules = [
      { match: /^SELECT id, payment_status, notes, table_id/, rows: [{ id: "chk-1", payment_status: "unpaid", notes: null, table_id: null }] },
      { match: /COUNT\(\*\)/, rows: [{ n: 2 }] },
    ];
    const withChildren = await run(() => cancelUnpaidChildlessCheckout("chk-1"));
    trace.length = 0;
    sqlRules = [];
    const missing = await run(() => cancelUnpaidChildlessCheckout("chk-1", { branchId: "br-1" }));
    expect({ already, withChildren, missing }).toMatchSnapshot();
  });
});
