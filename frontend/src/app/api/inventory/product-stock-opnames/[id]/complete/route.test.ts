// EPIC-047 Fase 3 — POST .../product-stock-opnames/[id]/complete dengan baris
// per SKU (produk merchandise ber-varian). Skenario wajib: campuran
// baris SKU (+/-/0) + baris non-varian byte-identical dalam satu opname,
// produk ber-varian dengan Σ selisih 0 di-skip total, guard baris SKU +
// baris level produk sekaligus → 400, regresi opname tanpa varian sama
// sekali (jalur lama, 0 pos_sku_id) tetap 1 movement per baris ber-selisih,
// caller ber-scope dari company lain → 404 (tanpa stock write), dan guard
// status di kolom `status <> 'completed'` (race double-complete) → 400.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { UserScope } from "@/lib/api/scope";

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", role: "admin" })),
  };
});

// Default: caller unscoped (super_admin-like) — scenario tests override
// scopeRef to exercise the scope guard.
let scopeRef: UserScope | null = {
  userId: "user-1",
  role: "super_admin",
  businessScope: null,
  holdingId: null,
  companyId: null,
  branchId: null,
  isUnscoped: true,
};

vi.mock("@/lib/api/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/scope")>();
  return {
    ...actual,
    getApiUserScope: vi.fn(async () => scopeRef),
  };
});

const insertFinishedGoodsMovementSqlMock =
  vi.fn<(client: unknown, params: Record<string, unknown>) => Promise<void>>(async () => {});
vi.mock("@/lib/inventory/finished-goods-movements", () => ({
  insertFinishedGoodsMovementSql: (...args: unknown[]) =>
    (insertFinishedGoodsMovementSqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

type DetailLine = {
  id: string;
  product_id: string;
  inventory_id: string;
  pos_sku_id: string | null;
  qty_system: number;
  qty_counted: number | null;
  qty_variance: number | null;
  unit_cost: number;
};

type Detail = {
  id: string;
  opname_number: string;
  status: string;
  warehouse_id: string;
  company_id?: string | null;
  branch_id?: string | null;
  lines: DetailLine[];
};

let detailRef: Detail;

const fetchProductStockOpnameDetailMock = vi.fn(async () => detailRef);
vi.mock("@/lib/inventory/product-stock-opname", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory/product-stock-opname")>();
  return {
    ...actual,
    fetchProductStockOpnameDetail: (...args: unknown[]) =>
      (fetchProductStockOpnameDetailMock as unknown as (...a: unknown[]) => unknown)(...args),
  };
});

// ---- Fake transaction client: SQL string ber-cabang sesuai pola di route,
// bukan FIFO per tabel (route ini pakai raw client.query, bukan db.from). --
type FakeClientConfig = {
  skuStock: Record<string, number>;
  inventories: Record<string, { qty_available: number; unit_cost: number }>;
  /** Simulasi race: UPDATE ... WHERE status <> 'completed' mengenai 0 baris
   *  (opname sudah di-complete oleh request lain lebih dulu). Default 1. */
  completeRowCount?: number;
};

function makeFakeClient(config: FakeClientConfig) {
  const calls: Array<{ kind: string; sql: string; params: unknown[] }> = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT stock_quantity\s+FROM pos\.pos_product_skus/.test(sql)) {
      calls.push({ kind: "select_sku_stock", sql, params });
      const skuId = params[0] as string;
      const stock = config.skuStock[skuId];
      return { rows: stock === undefined ? [] : [{ stock_quantity: stock }] };
    }
    if (/UPDATE pos\.pos_product_skus/.test(sql)) {
      calls.push({ kind: "update_sku_stock", sql, params });
      return { rows: [] };
    }
    if (/SELECT id, qty_available, unit_cost/.test(sql)) {
      calls.push({ kind: "select_fgi_for_product_delta", sql, params });
      const inventoryId = params[0] as string;
      const inv = config.inventories[inventoryId];
      return {
        rows: inv ? [{ id: inventoryId, qty_available: inv.qty_available, unit_cost: inv.unit_cost }] : [],
      };
    }
    if (/SELECT id, unit_cost\s+FROM inventory\.finished_goods_inventory/.test(sql)) {
      calls.push({ kind: "select_fgi_unit_cost_only", sql, params });
      const inventoryId = params[0] as string;
      const inv = config.inventories[inventoryId];
      return { rows: inv ? [{ id: inventoryId, unit_cost: inv.unit_cost }] : [] };
    }
    if (/UPDATE inventory\.finished_goods_inventory/.test(sql)) {
      calls.push({ kind: "update_fgi", sql, params });
      return { rows: [] };
    }
    if (/UPDATE inventory\.product_stock_opnames/.test(sql)) {
      calls.push({ kind: "update_opname_status", sql, params });
      return { rows: [], rowCount: config.completeRowCount ?? 1 };
    }
    throw new Error(`Fake client tidak mengenali query:\n${sql}`);
  });

  return { query, calls };
}

let fakeClientRef: ReturnType<typeof makeFakeClient>;

vi.mock("@/lib/db", () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn(fakeClientRef),
}));

function makeParams(id = "opname-1") {
  return { params: Promise.resolve({ id }) };
}

const WAREHOUSE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_PLAIN_ID = "33333333-3333-4333-8333-333333333333";
const INVENTORY_VARIANT_ID = "44444444-4444-4444-8444-444444444444";
const INVENTORY_PLAIN_ID = "55555555-5555-4555-8555-555555555555";
const SKU_M = "66666666-6666-4666-8666-666666666666";
const SKU_S = "77777777-7777-4777-8777-777777777777";
const SKU_L = "88888888-8888-4888-8888-888888888888";

beforeEach(() => {
  vi.clearAllMocks();
  scopeRef = {
    userId: "user-1",
    role: "super_admin",
    businessScope: null,
    holdingId: null,
    companyId: null,
    branchId: null,
    isUnscoped: true,
  };
});

describe("POST /api/inventory/product-stock-opnames/[id]/complete — per-SKU (EPIC-047 Fase 3)", () => {
  it("baris campuran: 2 SKU ber-selisih + 1 SKU nol + 1 produk non-varian → Σ varian & jalur lama byte-identical", async () => {
    detailRef = {
      id: "opname-1",
      opname_number: "OPN-001",
      status: "in_progress",
      warehouse_id: WAREHOUSE_ID,
      lines: [
        {
          id: "line-m",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: SKU_M,
          qty_system: 20,
          qty_counted: 18, // live stock 20 → delta -2
          qty_variance: -2,
          unit_cost: 25000,
        },
        {
          id: "line-s",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: SKU_S,
          qty_system: 5,
          qty_counted: 6, // live stock 5 → delta +1
          qty_variance: 1,
          unit_cost: 25000,
        },
        {
          id: "line-l",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: SKU_L,
          qty_system: 8,
          qty_counted: 8, // live stock 8 → delta 0
          qty_variance: 0,
          unit_cost: 25000,
        },
        {
          id: "line-plain",
          product_id: PRODUCT_PLAIN_ID,
          inventory_id: INVENTORY_PLAIN_ID,
          pos_sku_id: null,
          qty_system: 30,
          qty_counted: 32, // jalur lama: before = qty_system
          qty_variance: 2,
          unit_cost: 20000,
        },
      ],
    };

    fakeClientRef = makeFakeClient({
      skuStock: { [SKU_M]: 20, [SKU_S]: 5, [SKU_L]: 8 },
      inventories: {
        [INVENTORY_VARIANT_ID]: { qty_available: 100, unit_cost: 25000 },
        [INVENTORY_PLAIN_ID]: { qty_available: 50, unit_cost: 20000 },
      },
    });

    const { POST } = await import("./route");
    const res = await POST({} as NextRequest, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // SKU stock_quantity di-UPDATE hanya untuk M dan S (L delta 0 di-skip).
    const skuUpdates = fakeClientRef.calls.filter((c) => c.kind === "update_sku_stock");
    expect(skuUpdates).toHaveLength(2);
    expect(skuUpdates.map((c) => c.params[1])).toEqual([SKU_M, SKU_S]);
    expect(skuUpdates.map((c) => c.params[0])).toEqual([18, 6]);

    // finished_goods_inventory di-UPDATE untuk produk varian (Σ = -1) dan
    // produk non-varian (delta = +2) — 2 kali.
    const fgiUpdates = fakeClientRef.calls.filter((c) => c.kind === "update_fgi");
    expect(fgiUpdates).toHaveLength(2);
    const variantFgiUpdate = fgiUpdates.find((c) => c.params[2] === INVENTORY_VARIANT_ID);
    expect(variantFgiUpdate?.params[0]).toBe(99); // 100 + (-1)
    const plainFgiUpdate = fgiUpdates.find((c) => c.params[2] === INVENTORY_PLAIN_ID);
    expect(plainFgiUpdate?.params[0]).toBe(32); // qty_system 30 + delta 2

    // Movement: 2 SKU (M, S) + 1 Σ varian produk + 1 non-varian = 4.
    expect(insertFinishedGoodsMovementSqlMock).toHaveBeenCalledTimes(4);
    const skuMovementCalls = insertFinishedGoodsMovementSqlMock.mock.calls.filter(
      ([, params]: [unknown, Record<string, unknown>]) => Boolean(params.posSkuId)
    );
    expect(skuMovementCalls).toHaveLength(2);
    const variantSummaryMovement = insertFinishedGoodsMovementSqlMock.mock.calls.find(
      ([, params]: [unknown, Record<string, unknown>]) =>
        params.productId === PRODUCT_VARIANT_ID && !params.posSkuId
    );
    expect(variantSummaryMovement?.[1]).toMatchObject({
      qtyBefore: 100,
      qtyAfter: 99,
      alasan: "Stock opname completed (Σ varian)",
    });

    // Status opname diselesaikan.
    const statusUpdate = fakeClientRef.calls.find((c) => c.kind === "update_opname_status");
    expect(statusUpdate).toBeDefined();
  });

  it("produk ber-varian dengan Σ selisih 0 (SKU +/- saling meniadakan) → tidak ada movement/update level produk", async () => {
    detailRef = {
      id: "opname-2",
      opname_number: "OPN-002",
      status: "in_progress",
      warehouse_id: WAREHOUSE_ID,
      lines: [
        {
          id: "line-a",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: SKU_M,
          qty_system: 10,
          qty_counted: 8, // live 10 → -2
          qty_variance: -2,
          unit_cost: 25000,
        },
        {
          id: "line-b",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: SKU_S,
          qty_system: 5,
          qty_counted: 7, // live 5 → +2
          qty_variance: 2,
          unit_cost: 25000,
        },
      ],
    };

    fakeClientRef = makeFakeClient({
      skuStock: { [SKU_M]: 10, [SKU_S]: 5 },
      inventories: { [INVENTORY_VARIANT_ID]: { qty_available: 40, unit_cost: 25000 } },
    });

    const { POST } = await import("./route");
    const res = await POST({} as NextRequest, makeParams());
    expect(res.status).toBe(200);

    // Kedua SKU tetap di-UPDATE (masing-masing punya delta non-nol)...
    expect(fakeClientRef.calls.filter((c) => c.kind === "update_sku_stock")).toHaveLength(2);
    // ...tapi Σ = 0 → TIDAK ADA penyesuaian finished_goods_inventory produk.
    expect(fakeClientRef.calls.filter((c) => c.kind === "update_fgi")).toHaveLength(0);

    const productLevelMovement = insertFinishedGoodsMovementSqlMock.mock.calls.find(
      ([, params]: [unknown, Record<string, unknown>]) => !params.posSkuId
    );
    expect(productLevelMovement).toBeUndefined();
    // 2 movement SKU tetap tercatat.
    expect(insertFinishedGoodsMovementSqlMock).toHaveBeenCalledTimes(2);
  });

  it("guard: produk punya baris SKU sekaligus baris level produk dalam satu opname → 400, tidak ada movement", async () => {
    detailRef = {
      id: "opname-3",
      opname_number: "OPN-003",
      status: "in_progress",
      warehouse_id: WAREHOUSE_ID,
      lines: [
        {
          id: "line-sku",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: SKU_M,
          qty_system: 10,
          qty_counted: 10,
          qty_variance: 0,
          unit_cost: 25000,
        },
        {
          id: "line-product",
          product_id: PRODUCT_VARIANT_ID,
          inventory_id: INVENTORY_VARIANT_ID,
          pos_sku_id: null,
          qty_system: 40,
          qty_counted: 40,
          qty_variance: 0,
          unit_cost: 25000,
        },
      ],
    };

    fakeClientRef = makeFakeClient({
      skuStock: { [SKU_M]: 10 },
      inventories: { [INVENTORY_VARIANT_ID]: { qty_available: 40, unit_cost: 25000 } },
    });

    const { POST } = await import("./route");
    const res = await POST({} as NextRequest, makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/baris SKU dan baris level produk sekaligus/);

    expect(insertFinishedGoodsMovementSqlMock).not.toHaveBeenCalled();
    expect(fakeClientRef.calls.some((c) => c.kind === "update_opname_status")).toBe(false);
  });

  it("regresi non-varian: seluruh baris tanpa pos_sku_id → jalur lama (before = qty_system), 1 movement per baris ber-selisih", async () => {
    detailRef = {
      id: "opname-4",
      opname_number: "OPN-004",
      status: "in_progress",
      warehouse_id: WAREHOUSE_ID,
      lines: [
        {
          id: "line-1",
          product_id: PRODUCT_PLAIN_ID,
          inventory_id: INVENTORY_PLAIN_ID,
          pos_sku_id: null,
          qty_system: 100,
          qty_counted: 95, // delta -5
          qty_variance: -5,
          unit_cost: 20000,
        },
        {
          id: "line-2",
          product_id: PRODUCT_PLAIN_ID,
          inventory_id: INVENTORY_PLAIN_ID,
          pos_sku_id: null,
          qty_system: 10,
          qty_counted: 10, // delta 0 → di-skip, SAMA seperti jalur lama
          qty_variance: 0,
          unit_cost: 20000,
        },
      ],
    };

    fakeClientRef = makeFakeClient({
      skuStock: {},
      inventories: { [INVENTORY_PLAIN_ID]: { qty_available: 999, unit_cost: 20000 } },
    });

    const { POST } = await import("./route");
    const res = await POST({} as NextRequest, makeParams());
    expect(res.status).toBe(200);

    // Tidak ada query SKU sama sekali (jalur lama tidak menyentuh pos_product_skus).
    expect(fakeClientRef.calls.some((c) => c.kind.includes("sku"))).toBe(false);
    // 1 UPDATE finished_goods_inventory (hanya line-1, line-2 delta 0 di-skip).
    expect(fakeClientRef.calls.filter((c) => c.kind === "update_fgi")).toHaveLength(1);
    expect(insertFinishedGoodsMovementSqlMock).toHaveBeenCalledTimes(1);
    const [, params] = insertFinishedGoodsMovementSqlMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(params).toMatchObject({ qtyBefore: 100, qtyAfter: 95 });
    expect(params.posSkuId).toBeUndefined();
  });

  it("scope: caller dari company lain → 404 (bukan 403), tanpa stock write", async () => {
    detailRef = {
      id: "opname-5",
      opname_number: "OPN-005",
      status: "in_progress",
      warehouse_id: WAREHOUSE_ID,
      company_id: "company-owner",
      branch_id: null,
      lines: [
        {
          id: "line-1",
          product_id: PRODUCT_PLAIN_ID,
          inventory_id: INVENTORY_PLAIN_ID,
          pos_sku_id: null,
          qty_system: 100,
          qty_counted: 95,
          qty_variance: -5,
          unit_cost: 20000,
        },
      ],
    };

    // Caller berscope company lain (bukan company pemilik opname).
    scopeRef = {
      userId: "user-2",
      role: "company_admin",
      businessScope: "company",
      holdingId: null,
      companyId: "company-other",
      branchId: null,
      isUnscoped: false,
    };

    fakeClientRef = makeFakeClient({
      skuStock: {},
      inventories: { [INVENTORY_PLAIN_ID]: { qty_available: 999, unit_cost: 20000 } },
    });

    const { POST } = await import("./route");
    const res = await POST({} as NextRequest, makeParams("opname-5"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/tidak ditemukan/);

    // Ditolak sebelum transaksi apa pun — tidak ada write stok/movement.
    expect(fakeClientRef.calls).toHaveLength(0);
    expect(insertFinishedGoodsMovementSqlMock).not.toHaveBeenCalled();
  });

  it("status guard: UPDATE ... WHERE status <> 'completed' kena 0 baris (race double-complete) → 400, tidak ada movement baru", async () => {
    detailRef = {
      id: "opname-6",
      opname_number: "OPN-006",
      status: "in_progress",
      warehouse_id: WAREHOUSE_ID,
      lines: [
        {
          id: "line-1",
          product_id: PRODUCT_PLAIN_ID,
          inventory_id: INVENTORY_PLAIN_ID,
          pos_sku_id: null,
          qty_system: 100,
          qty_counted: 95, // delta -5 — movement tetap tercatat sebelum guard status gagal
          qty_variance: -5,
          unit_cost: 20000,
        },
      ],
    };

    fakeClientRef = makeFakeClient({
      skuStock: {},
      inventories: { [INVENTORY_PLAIN_ID]: { qty_available: 999, unit_cost: 20000 } },
      // Simulasi: request lain sudah men-complete opname ini duluan — UPDATE
      // dengan predikat status <> 'completed' kena 0 baris.
      completeRowCount: 0,
    });

    const { POST } = await import("./route");
    const res = await POST({} as NextRequest, makeParams("opname-6"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/sudah diselesaikan sebelumnya/);

    // UPDATE status memang dicoba (dan gagal kena 0 baris) — dalam DB nyata
    // seluruh transaksi ini di-ROLLBACK oleh withTransaction (lihat src/lib/db.ts).
    const statusUpdate = fakeClientRef.calls.find((c) => c.kind === "update_opname_status");
    expect(statusUpdate).toBeDefined();
  });
});
