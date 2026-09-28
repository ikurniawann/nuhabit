// Self-order meja — POST /api/table-order/orders: harga dihitung ulang dari
// katalog (bukan dari klien), ARK Coin wajib sesi member, QRIS dicek sebelum
// order dibuat, item yang tidak dijual/varian asing ditolak sebelum insert.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

type FakeResult = { data: unknown; error: unknown };

function createFakeDb(
  responses: Record<string, FakeResult[]>,
  rpcResponses: Record<string, FakeResult> = {}
) {
  const calls: Array<{ table: string; action: string; payload?: unknown }> = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];

  function builder(table: string) {
    const state: { action: string; payload?: unknown } = { action: "select" };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      single: () => b,
      maybeSingle: () => b,
      insert: (payload: unknown) => {
        state.action = "insert";
        state.payload = payload;
        return b;
      },
      update: (payload: unknown) => {
        state.action = "update";
        state.payload = payload;
        return b;
      },
      then: (resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) => {
        calls.push({ table, action: state.action, payload: state.payload });
        const queue = responses[table] ?? [];
        const result = queue.length > 0 ? queue.shift()! : { data: null, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  }

  const db = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return rpcResponses[name] ?? { data: null, error: null };
    }),
  };
  return { db, calls, rpcCalls };
}

let fake: ReturnType<typeof createFakeDb>;
const memberSession = vi.fn<() => Promise<{ customerId: string } | null>>(async () => null);
const loadXendit = vi.fn(async () => ({
  secretKey: "sk",
  webhookToken: null,
  callbackUrl: null,
  environment: "sandbox" as const,
}));
const ensureQris = vi.fn(async () => ({
  qr_id: "qr-1",
  reference_id: "pos-ord-order-1",
  qr_string: "000201QRIS",
  amount: 110000,
  expires_at: null,
}));

vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: vi.fn(() => fake.db),
}));
vi.mock("@/lib/member-portal/session", () => ({
  getMemberSession: () => memberSession(),
}));
vi.mock("@/lib/payments/xendit", () => ({
  loadActiveXenditConfig: () => loadXendit(),
}));
const fireOrderAlert = vi.fn();
vi.mock("@/lib/notifications/order-alert-server", () => ({
  fireOrderAlert: (...args: unknown[]) => fireOrderAlert(...args),
}));
const loadStatic = vi.fn(async () => ({ enabled: false, imageUrl: null as string | null, available: false }));
vi.mock("@/lib/payments/static-qris", () => ({
  loadStaticQris: () => loadStatic(),
}));
vi.mock("@/lib/table-order/qris", () => ({
  ensureOrderQris: (...args: unknown[]) => ensureQris(...(args as [])),
}));
vi.mock("@/lib/crm/product-privilege", () => ({
  checkProductPrivileges: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/crm/loyalty-engine", () => ({
  awardCrmXpForPosOrder: vi.fn(async () => ({ status: "awarded", xpAwarded: 10 })),
  syncPosCustomerOrderStats: vi.fn(async () => undefined),
}));
vi.mock("@/lib/pos/accounting-posting", () => ({
  postPosSaleAccountingJournals: vi.fn(async () => undefined),
}));
vi.mock("@/lib/pos/queue-number", () => ({
  allocateQueueNumber: vi.fn(async () => "A-007"),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetTime: 0 })),
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OFF_PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SHOT_ID = "33333333-3333-4333-8333-333333333333";
const DOUBLE_ID = "44444444-4444-4444-8444-444444444444";
const OAT_MILK_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_ID = "66666666-6666-4666-8666-666666666666";

const catalog = new Map([
  [
    PRODUCT_ID,
    {
      id: PRODUCT_ID,
      sku: "LATTE",
      name: "Iced Latte",
      description: "",
      price: 30000,
      xp: 30,
      station: "bar",
      stationLabel: "Bar",
      image: null,
      categoryId: null,
      categoryName: "Minuman",
      prepTimeMinutes: 0,
      minXp: 0,
      variants: [
        { id: "reg", name: "Regular", priceAdjustment: 0 },
        { id: "oat", name: "Oat", priceAdjustment: 10000 },
      ],
      modifierGroups: [
        {
          id: "g-shot",
          name: "Tambahan Espresso",
          minSelection: 0,
          maxSelection: 1,
          modifiers: [
            { id: SHOT_ID, name: "Extra Shot Espresso", priceAdjustment: 10000 },
            { id: DOUBLE_ID, name: "Double Shot", priceAdjustment: 18000 },
          ],
        },
        {
          id: "g-milk",
          name: "Pilihan Susu",
          minSelection: 0,
          maxSelection: 1,
          modifiers: [{ id: OAT_MILK_ID, name: "Oat Milk", priceAdjustment: 5000 }],
        },
      ],
      customizable: true,
      sellable: true,
    },
  ],
  [
    OFF_PRODUCT_ID,
    {
      id: OFF_PRODUCT_ID,
      sku: "OFF",
      name: "Habis",
      description: "",
      price: 5000,
      xp: 0,
      station: "kitchen",
      stationLabel: "Kitchen",
      image: null,
      categoryId: null,
      categoryName: "Makanan",
      prepTimeMinutes: 0,
      minXp: 0,
      variants: [],
      customizable: false,
      sellable: false,
    },
  ],
]);

vi.mock("@/lib/table-order/server", () => ({
  TABLE_ORDER_TAG: "Self-service table order",
  clientIdentifier: () => "test-ip",
  loadProductsByIds: vi.fn(async () => catalog),
  loadTableByCode: vi.fn(async () => ({ id: "table-1", is_active: true, name: "WIT. Office Bandung" })),
  tableLabel: (table: { name?: string } | null, code: string) => table?.name || code,
  loadVenueContext: vi.fn(async () => ({
    companyId: "company-1",
    branchId: "branch-1",
    brandName: "BCD Coffee",
    billingProfileName: "System",
    qrisAvailable: true,
    arkRate: 1000,
    charges: [
      {
        code: "TAX",
        name: "PB1",
        charge_kind: "tax",
        calc_method: "percent",
        rate: 10,
        amount: 0,
        apply_order: 200,
        is_enabled: true,
        is_optional: false,
        base: "subtotal_after_discount",
      },
    ],
  })),
}));

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

function baseDbResponses() {
  return {
    pos_orders: [{ data: { id: "order-1", order_number: "ORD-1" }, error: null }],
    pos_order_items: [{ data: null, error: null }],
    pos_order_status_history: [{ data: null, error: null }],
  };
}

const rpcOk = {
  generate_order_number: { data: "ORD-1", error: null },
  update_ark_coin_balance: { data: null, error: null },
};

/** Tamu wajib nomor WA + nama (2026-09-28) — default untuk kasus lain. */
const GUEST = { guest_name: "Budi", guest_phone: "081234567890" };

async function post(body: unknown, withGuest = true) {
  const { POST } = await import("./route");
  const payload = withGuest && body && typeof body === "object" ? { ...GUEST, ...(body as object) } : body;
  const response = await POST(makeRequest(payload));
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  fake = createFakeDb(baseDbResponses(), rpcOk);
  memberSession.mockReset();
  memberSession.mockResolvedValue(null);
  loadXendit.mockClear();
  ensureQris.mockClear();
  fireOrderAlert.mockClear();
  loadStatic.mockReset();
  loadStatic.mockResolvedValue({ enabled: false, imageUrl: null, available: false });
});

describe("POST /api/table-order/orders — harga dari server", () => {
  it("klien hanya kirim id+qty; unit_price/total dihitung dari katalog + profil billing venue", async () => {
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [
        { product_id: PRODUCT_ID, variant_id: "oat", quantity: 2, unit_price: 1 },
        { product_id: PRODUCT_ID, variant_id: "reg", quantity: 1 },
      ],
    });

    expect(status).toBe(201);
    const orderInsert = fake.calls.find((c) => c.table === "pos_orders" && c.action === "insert");
    const order = orderInsert?.payload as Record<string, unknown>;
    // (30.000+10.000)×2 + 30.000 = 110.000 ; PB1 10% = 11.000
    expect(order.subtotal).toBe(110000);
    expect(order.tax_amount).toBe(11000);
    expect(order.total_amount).toBe(121000);
    expect(order.payment_status).toBe("unpaid");
    expect(order.status).toBe("pending");
    expect(order.order_type).toBe("dine_in");
    expect(order.table_id).toBe("table-1");
    expect(order.customer_id).toBeNull();

    const itemsInsert = fake.calls.find((c) => c.table === "pos_order_items" && c.action === "insert");
    const items = itemsInsert?.payload as Array<Record<string, unknown>>;
    expect(items.map((i) => [i.unit_price, i.quantity, i.station, i.xp_earned])).toEqual([
      [40000, 2, "bar", 60],
      [30000, 1, "bar", 30],
    ]);
    expect(items[0].variants).toEqual([{ name: "Oat" }]);

    const data = json.data as Record<string, unknown>;
    expect(data.queue_number).toBe("A-007");
    expect(data.total_amount).toBe(121000);
    expect(data.qris).toBeNull();
  });

  it("add-on: harga dari katalog server, disimpan ke item order (nama & grup) untuk KDS", async () => {
    const { status } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [
        // price/unit_price dari klien diabaikan — hanya id yang dipakai.
        { product_id: PRODUCT_ID, variant_id: "reg", modifier_ids: [SHOT_ID, OAT_MILK_ID], quantity: 2, unit_price: 1 },
      ],
    });
    expect(status).toBe(201);
    const order = fake.calls.find((c) => c.table === "pos_orders" && c.action === "insert")?.payload as Record<string, unknown>;
    // (30.000 + 10.000 + 5.000) × 2 = 90.000 ; PB1 10% = 9.000
    expect(order.subtotal).toBe(90000);
    expect(order.total_amount).toBe(99000);
    const items = fake.calls.find((c) => c.table === "pos_order_items" && c.action === "insert")?.payload as Array<Record<string, unknown>>;
    expect(items[0].unit_price).toBe(45000);
    expect(items[0].modifiers).toEqual([
      { name: "Extra Shot Espresso", group: "Tambahan Espresso", price: 10000 },
      { name: "Oat Milk", group: "Pilihan Susu", price: 5000 },
    ]);
  });

  it("add-on milik produk lain / tak dikenal → 409 tanpa insert", async () => {
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [{ product_id: PRODUCT_ID, modifier_ids: [FOREIGN_ID], quantity: 1 }],
    });
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/tidak dikenal/);
    expect(fake.calls.filter((c) => c.action === "insert")).toHaveLength(0);
  });

  it("melebihi batas grup (maks 1) → 409 tanpa insert", async () => {
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [{ product_id: PRODUCT_ID, modifier_ids: [SHOT_ID, DOUBLE_ID], quantity: 1 }],
    });
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/maksimal 1/);
    expect(fake.calls.filter((c) => c.action === "insert")).toHaveLength(0);
  });

  it("id add-on bukan UUID → 400 (validasi schema)", async () => {
    const { status } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [{ product_id: PRODUCT_ID, modifier_ids: ["bukan-uuid"], quantity: 1 }],
    });
    expect(status).toBe(400);
  });

  it("produk yang tidak dijual → 409 tanpa insert apa pun", async () => {
    const { status } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [{ product_id: OFF_PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(409);
    expect(fake.calls.filter((c) => c.action === "insert")).toHaveLength(0);
  });

  it("varian tidak dikenal → 409", async () => {
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "cashier",
      items: [{ product_id: PRODUCT_ID, variant_id: "palsu", quantity: 1 }],
    });
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/Varian/);
  });

  it("body tidak valid (metode VA tidak didukung) → 400", async () => {
    const { status } = await post({
      table_code: "T-01",
      payment_method: "va",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(400);
  });
});

describe("POST /api/table-order/orders — ARK Coin", () => {
  it("tanpa sesi member → 401, saldo tidak disentuh", async () => {
    const { status } = await post({
      table_code: "T-01",
      payment_method: "ark_coin",
      customer_id: "99999999-9999-4999-8999-999999999999",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(401);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.calls.filter((c) => c.action === "insert")).toHaveLength(0);
  });

  it("dengan sesi member → customer dari sesi, saldo dipotong sebesar total, order paid/confirmed", async () => {
    memberSession.mockResolvedValue({ customerId: "cust-1" });
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "ark_coin",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(201);
    const deduct = fake.rpcCalls.find((c) => c.name === "update_ark_coin_balance");
    expect(deduct?.args).toMatchObject({ p_customer_id: "cust-1", p_amount: -33000 });
    const order = fake.calls.find((c) => c.table === "pos_orders" && c.action === "insert")
      ?.payload as Record<string, unknown>;
    expect(order.customer_id).toBe("cust-1");
    expect(order.payment_status).toBe("paid");
    expect(order.status).toBe("confirmed");
    expect(order.ark_coins_used).toBe(33000);
    expect((json.data as Record<string, unknown>).payment_status).toBe("paid");
  });

  it("saldo tidak cukup → 400 dan order tidak dibuat", async () => {
    memberSession.mockResolvedValue({ customerId: "cust-1" });
    fake = createFakeDb(baseDbResponses(), {
      ...rpcOk,
      update_ark_coin_balance: { data: null, error: { message: "Insufficient balance" } },
    });
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "ark_coin",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/tidak cukup/);
    expect(fake.calls.filter((c) => c.action === "insert")).toHaveLength(0);
  });
});

describe("POST /api/table-order/orders — QRIS", () => {
  it("gateway belum dikonfigurasi → 503 SEBELUM order dibuat", async () => {
    loadXendit.mockRejectedValueOnce(new Error("QRIS payment gateway is not configured."));
    const { status } = await post({
      table_code: "T-01",
      payment_method: "qris",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(503);
    expect(fake.calls.filter((c) => c.action === "insert")).toHaveLength(0);
    expect(ensureQris).not.toHaveBeenCalled();
  });

  it("gateway siap → order unpaid + QR terikat order dikembalikan ke pemesan", async () => {
    const { status, json } = await post({
      table_code: "T-01",
      order_type: "takeaway",
      payment_method: "qris",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(201);
    expect(ensureQris).toHaveBeenCalledTimes(1);
    const [, orderArg] = ensureQris.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(orderArg).toMatchObject({ id: "order-1", total_amount: 33000 });
    const data = json.data as Record<string, unknown>;
    expect(data.order_type).toBe("takeaway");
    expect(data.payment_flow).toBe("qris");
    expect((data.qris as Record<string, unknown>).qr_string).toBe("000201QRIS");
  });

  it("QR gagal dibuat setelah order tersimpan → tetap 201, payment_flow jatuh ke kasir", async () => {
    ensureQris.mockRejectedValueOnce(new Error("Xendit timeout"));
    fake = createFakeDb(
      { ...baseDbResponses(), pos_orders: [{ data: { id: "order-1" }, error: null }, { data: null, error: null }] },
      rpcOk
    );
    const { status, json } = await post({
      table_code: "T-01",
      payment_method: "qris",
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    });
    expect(status).toBe(201);
    const data = json.data as Record<string, unknown>;
    expect(data.payment_flow).toBe("cashier");
    expect(data.qris).toBeNull();
    expect(data.qris_error).toBe("Xendit timeout");
  });
});

describe("POST /api/table-order/orders — Static QRIS", () => {
  const body = {
    table_code: "WIT-OFFICE-BDG",
    payment_method: "static_qris",
    items: [{ product_id: PRODUCT_ID, variant_id: "reg", quantity: 1 }],
  };

  it("belum diaktifkan/tanpa gambar → 503 SEBELUM order dibuat", async () => {
    const { status, json } = await post(body);
    expect(status).toBe(503);
    expect(String(json.error)).toMatch(/Static QRIS belum tersedia/);
    expect(fake.calls.some((c) => c.action === "insert")).toBe(false);
  });

  it("aktif → order unpaid/pending ditandai payment=static_qris, tanpa QR Xendit", async () => {
    loadStatic.mockResolvedValue({ enabled: true, imageUrl: "/api/files/payment-qris/q.png", available: true });
    const { status, json } = await post(body);
    expect(status).toBe(201);
    const order = fake.calls.find((c) => c.table === "pos_orders" && c.action === "insert")?.payload as Record<
      string,
      unknown
    >;
    expect(order.payment_status).toBe("unpaid");
    expect(order.status).toBe("pending");
    expect(order.payment_method).toBeNull();
    expect(order.special_requests).toBe("Self-service table order WIT-OFFICE-BDG; payment=static_qris");
    expect((json.data as Record<string, unknown>).payment_flow).toBe("static_qris");
    expect(loadXendit).not.toHaveBeenCalled();
    expect(ensureQris).not.toHaveBeenCalled();
  });
});

describe("POST /api/table-order/orders — notifikasi staf", () => {
  it("order sukses memicu notifikasi (meja, antrean, item + add-on, total, status bayar)", async () => {
    const { status } = await post({
      table_code: "WIT-OFFICE-BDG",
      payment_method: "cashier",
      guest_name: "Budi",
      customer_note: "less ice",
      items: [{ product_id: PRODUCT_ID, variant_id: "reg", modifier_ids: [SHOT_ID], quantity: 2 }],
    });
    expect(status).toBe(201);
    expect(fireOrderAlert).toHaveBeenCalledTimes(1);
    expect(fireOrderAlert.mock.calls[0][0]).toMatchObject({
      sourceLabel: "Self-order QR",
      tableLabel: "WIT. Office Bandung",
      queueNumber: "A-007",
      orderNumber: "ORD-1",
      paymentLabel: "Bayar di kasir",
      paid: false,
      guestName: "Budi",
      customerNote: "less ice",
      items: [{ name: "Iced Latte", quantity: 2, variant: "Regular", modifiers: ["Extra Shot Espresso"] }],
    });
  });

  it("order ditolak (validasi) tidak memicu notifikasi", async () => {
    await post({ table_code: "T-01", payment_method: "cashier", items: [{ product_id: OFF_PRODUCT_ID, quantity: 1 }] });
    expect(fireOrderAlert).not.toHaveBeenCalled();
  });
});

describe("POST /api/table-order/orders — nomor WA & nama wajib", () => {
  const base = { table_code: "T-01", payment_method: "cashier", items: [{ product_id: PRODUCT_ID, variant_id: "reg", quantity: 1 }] };

  it("tamu tanpa nomor / nomor tidak valid / tanpa nama → 400, tidak ada insert", async () => {
    expect((await post({ ...base, guest_name: "Budi" }, false)).status).toBe(400);
    expect((await post({ ...base, guest_name: "Budi", guest_phone: "12345" }, false)).status).toBe(400);
    expect((await post({ ...base, guest_phone: "081234567890" }, false)).status).toBe(400);
    expect(fake.calls.some((c) => c.action === "insert")).toBe(false);
  });

  it("tamu valid → kontak tersimpan (628…), catatan kasir memuat nama & WA, tidak ditautkan ke member", async () => {
    const { status } = await post({ ...base, guest_name: " Budi ", guest_phone: "0812-3456-7890" }, false);
    expect(status).toBe(201);
    const order = fake.calls.find((c) => c.table === "pos_orders" && c.action === "insert")?.payload as Record<string, unknown>;
    expect(order.contact_name).toBe("Budi");
    expect(order.contact_phone).toBe("6281234567890");
    expect(order.customer_id).toBeNull();
    expect(String(order.notes)).toContain("Atas nama: Budi · WA 6281234567890");
    expect(fireOrderAlert.mock.calls[0][0]).toMatchObject({ guestName: "Budi", guestPhone: "6281234567890" });
  });

  it("member login tidak perlu isi nomor/nama tamu; nama member tetap ada di notifikasi", async () => {
    memberSession.mockResolvedValue({ customerId: "cust-1" });
    fake = createFakeDb({ ...baseDbResponses(), pos_customers: [{ data: { name: "Riksa", phone: "6281200001111" }, error: null }] }, rpcOk);
    const { status } = await post(base, false);
    expect(status).toBe(201);
    const order = fake.calls.find((c) => c.table === "pos_orders" && c.action === "insert")?.payload as Record<string, unknown>;
    expect(order.customer_id).toBe("cust-1");
    expect(order.contact_phone).toBeNull();
    expect(fireOrderAlert.mock.calls[0][0]).toMatchObject({ guestName: "Riksa", guestPhone: "6281200001111", isMember: true });
  });
});
