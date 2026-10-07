// EPIC-047 Fase 1B — PATCH .../orders/[id] action "complete" dengan rincian
// per varian (variant_output). Empat skenario wajib: 400 saat wajib tapi
// tidak dikirim, 400 saat jumlah tidak cocok, jalur lama utuh saat produk
// tidak ber-varian (F&B/WIP/produk tanpa link POS merchandise), dan posting
// SKU idempoten (ON CONFLICT DO NOTHING tidak pernah menggandakan stok).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", role: "admin" })),
}));

vi.mock("@/lib/inventory", () => ({
  addInventoryFromProduction: vi.fn(async () => ({})),
}));

const recordFinishedGoodsMovementMock = vi.fn<(...args: unknown[]) => Promise<{ id: string }>>(
  async () => ({ id: "movement-1" })
);
vi.mock("@/lib/inventory/finished-goods-movements", () => ({
  recordFinishedGoodsMovement: (...args: unknown[]) =>
    (recordFinishedGoodsMovementMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/lib/pos/purchasing-sync", () => ({
  syncProductionHppToPos: vi.fn(async () => ({ margin_percentage: 40 })),
}));

const queryOneMock = vi.fn();
vi.mock("@/lib/db", () => ({
  queryOne: (...args: unknown[]) => (queryOneMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

// ---- Fake query-builder db (FIFO respons per tabel, meniru urutan
// pemanggilan db.from(table) persis seperti di route). --------------------
type FakeResult = { data: unknown; error: unknown };

function createFakeDb(responses: Record<string, FakeResult[]>) {
  const calls: Array<{ table: string; action: string; payload?: unknown }> = [];

  function nextResponse(table: string): FakeResult {
    const queue = responses[table];
    if (!queue || queue.length === 0) {
      throw new Error(`Tidak ada mock response tersisa untuk tabel "${table}"`);
    }
    return queue.shift()!;
  }

  function builder(table: string) {
    const state: { action: string; payload?: unknown } = { action: "select" };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
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
      upsert: (payload: unknown) => {
        state.action = "upsert";
        state.payload = payload;
        return b;
      },
      then: (resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) => {
        calls.push({ table, action: state.action, payload: state.payload });
        try {
          const result = nextResponse(table);
          return Promise.resolve(result).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).catch(reject);
        }
      },
    };
    return b;
  }

  const db = { from: vi.fn((table: string) => builder(table)) };
  return { db, calls };
}

vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: vi.fn(() => fakeDbRef.db),
}));

let fakeDbRef: ReturnType<typeof createFakeDb>;

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id = "order-1") {
  return { params: Promise.resolve({ id }) };
}

// zod memvalidasi variant_output[].pos_sku_id sebagai uuid — id SKU di test
// ini harus berbentuk uuid asli, bukan slug pendek.
const SKU_S = "11111111-1111-4111-8111-111111111111";
const SKU_M = "22222222-2222-4222-8222-222222222222";
const SKU_L = "33333333-3333-4333-8333-333333333333";
const SKU_XL = "44444444-4444-4444-8444-444444444444";

const baseOrder = {
  id: "order-1",
  nomor_produksi: "PROD-001",
  status: "IN_PROGRESS",
  production_context: "product",
  output_type: "FINISHED_GOOD",
  output_raw_material_id: null,
  product_id: "product-1",
  planned_qty: 100,
  overhead_cost: 0,
  labor_cost: 0,
  packaging_cost: 0,
  waste_cost: 0,
  product: { id: "product-1", kode: "KAOS-001", nama: "Kaos Polos", satuan_id: "unit-1" },
};

const oneMaterialRow = [
  {
    id: "material-1",
    production_order_id: "order-1",
    raw_material_id: "rm-1",
    qty_planned: 10,
    qty_actual: 10,
    waste_qty: 0,
    unit_cost: 100,
    total_cost: 1000,
    inventory_movement_id: "movement-existing", // sudah ada -> skip tulis inventory
  },
];

const fourActiveSkus = [
  { id: SKU_S, sku: "KAOS-001-S-HTM", name: "Kaos — S / Hitam", options: { ukuran: "S", warna: "Hitam" }, stock_quantity: 0 },
  { id: SKU_M, sku: "KAOS-001-M-HTM", name: "Kaos — M / Hitam", options: { ukuran: "M", warna: "Hitam" }, stock_quantity: 0 },
  { id: SKU_L, sku: "KAOS-001-L-HTM", name: "Kaos — L / Hitam", options: { ukuran: "L", warna: "Hitam" }, stock_quantity: 0 },
  { id: SKU_XL, sku: "KAOS-001-XL-HTM", name: "Kaos — XL / Hitam", options: { ukuran: "XL", warna: "Hitam" }, stock_quantity: 5 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH .../orders/[id] action complete — EPIC-047 Fase 1B variant_output", () => {
  it("400 kalau produk ber-varian tapi variant_output tidak dikirim — available_skus berisi 4 SKU aktif", async () => {
    fakeDbRef = createFakeDb({
      production_orders: [{ data: baseOrder, error: null }],
      production_order_materials: [{ data: oneMaterialRow, error: null }],
      pos_products: [{ data: { id: "pos-product-1" }, error: null }],
      pos_product_skus: [{ data: fourActiveSkus, error: null }],
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeRequest({ action: "complete", actual_qty: 100 }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Rincian varian wajib diisi");
    expect(body.details.available_skus).toHaveLength(4);
    expect(body.details.available_skus.map((s: { id: string }) => s.id)).toEqual([
      SKU_S,
      SKU_M,
      SKU_L,
      SKU_XL,
    ]);
    // Tidak ada tulisan apa pun setelah gerbang gagal.
    expect(recordFinishedGoodsMovementMock).not.toHaveBeenCalled();
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it("400 kalau jumlah split tidak sama dengan actual_qty (90 vs 100)", async () => {
    fakeDbRef = createFakeDb({
      production_orders: [{ data: baseOrder, error: null }],
      production_order_materials: [{ data: oneMaterialRow, error: null }],
      pos_products: [{ data: { id: "pos-product-1" }, error: null }],
      pos_product_skus: [{ data: fourActiveSkus, error: null }],
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeRequest({
        action: "complete",
        actual_qty: 100,
        variant_output: [
          { pos_sku_id: SKU_S, qty: 20 },
          { pos_sku_id: SKU_M, qty: 30 },
          { pos_sku_id: SKU_L, qty: 30 },
          { pos_sku_id: SKU_XL, qty: 10 },
        ],
      }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe(
      "Rincian varian harus berjumlah sama dengan jumlah aktual (90 vs 100)"
    );
    expect(recordFinishedGoodsMovementMock).not.toHaveBeenCalled();
  });

  it("passthrough: produk tanpa link POS merchandise (F&B/WIP lama) — variant_output diabaikan, 200 seperti biasa", async () => {
    fakeDbRef = createFakeDb({
      production_orders: [
        { data: baseOrder, error: null }, // select awal
        { data: { ...baseOrder, status: "COMPLETED" }, error: null }, // update akhir
      ],
      production_order_materials: [
        { data: oneMaterialRow, error: null }, // load awal
        { data: oneMaterialRow, error: null }, // validateMaterialStock (actual)
        { data: null, error: null }, // update material (inventory_movement_id sudah ada)
      ],
      pos_products: [{ data: null, error: null }], // tidak tertaut POS merchandise
      v_raw_materials_stock: [
        { data: [{ id: "rm-1", qty_onhand: 999, avg_cost: 100 }], error: null },
      ],
      production_batches: [
        { data: null, error: null }, // belum ada batch
        { data: { id: "batch-1", batch_number: "PROD-001-B01" }, error: null }, // insert batch
      ],
      finished_goods_inventory: [
        { data: null, error: null }, // belum ada stok produk
        { data: { id: "fgi-1" }, error: null }, // insert stok produk
      ],
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeRequest({ action: "complete", actual_qty: 100 }),
      makeParams()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Tidak pernah menyentuh production_output_variants / pos_product_skus.
    const touchedVariantTable = fakeDbRef.db.from.mock.calls.some(
      ([table]: [string]) => table === "production_output_variants"
    );
    expect(touchedVariantTable).toBe(false);
    expect(queryOneMock).not.toHaveBeenCalled();
    // Baris finished_goods_movements level produk tetap diposting (1x, tanpa pos_sku_id).
    expect(recordFinishedGoodsMovementMock).toHaveBeenCalledTimes(1);
    expect(recordFinishedGoodsMovementMock.mock.calls[0][1]).not.toHaveProperty("posSkuId");
  });

  it("idempoten: production_output_variants ON CONFLICT DO NOTHING (0 baris ter-insert) tidak membumbui stok SKU / movement varian sama sekali", async () => {
    fakeDbRef = createFakeDb({
      production_orders: [
        { data: baseOrder, error: null },
        { data: { ...baseOrder, status: "COMPLETED" }, error: null },
      ],
      production_order_materials: [
        { data: oneMaterialRow, error: null },
        { data: oneMaterialRow, error: null },
        { data: null, error: null },
      ],
      pos_products: [{ data: { id: "pos-product-1" }, error: null }],
      pos_product_skus: [{ data: fourActiveSkus, error: null }],
      v_raw_materials_stock: [
        { data: [{ id: "rm-1", qty_onhand: 999, avg_cost: 100 }], error: null },
      ],
      production_batches: [
        // Batch sudah ada dari complete pertama.
        { data: { id: "batch-1", batch_number: "PROD-001-B01" }, error: null },
        { data: { id: "batch-1", batch_number: "PROD-001-B01" }, error: null }, // update batch
      ],
      // ON CONFLICT DO NOTHING — semua 4 baris sudah ada, RETURNING kosong.
      production_output_variants: [{ data: [], error: null }],
      finished_goods_inventory: [
        { data: { id: "fgi-1", qty_available: 100, unit_cost: 5000 }, error: null },
        { data: null, error: null }, // update tidak pakai .select().single() -> data null
      ],
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeRequest({
        action: "complete",
        actual_qty: 100,
        variant_output: [
          { pos_sku_id: SKU_S, qty: 20 },
          { pos_sku_id: SKU_M, qty: 30 },
          { pos_sku_id: SKU_L, qty: 30 },
          { pos_sku_id: SKU_XL, qty: 20 },
        ],
      }),
      makeParams()
    );
    expect(res.status).toBe(200);
    // Tidak ada UPDATE stock_quantity SKU sama sekali — tidak ada baris insert baru.
    expect(queryOneMock).not.toHaveBeenCalled();
    // Hanya baris movement level produk yang diposting, nol baris per-varian.
    expect(recordFinishedGoodsMovementMock).toHaveBeenCalledTimes(1);
  });

  it("guard status: complete order yang sudah COMPLETED ditolak 400, tidak ada tulisan apa pun", async () => {
    fakeDbRef = createFakeDb({
      production_orders: [{ data: { ...baseOrder, status: "COMPLETED" }, error: null }],
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeRequest({ action: "complete", actual_qty: 100 }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Produksi harus IN_PROGRESS sebelum completed");
    expect(recordFinishedGoodsMovementMock).not.toHaveBeenCalled();
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it("400 kalau variant_output berisi 101 baris — melewati batas .max(100), ditolak zod sebelum sentuh db", async () => {
    fakeDbRef = createFakeDb({});

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeRequest({
        action: "complete",
        actual_qty: 101,
        variant_output: Array.from({ length: 101 }, (_, i) => ({
          pos_sku_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          qty: 1,
        })),
      }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect(fakeDbRef.db.from).not.toHaveBeenCalled();
  });
});
