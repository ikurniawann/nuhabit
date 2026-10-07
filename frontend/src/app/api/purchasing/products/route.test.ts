// Route test master produk: validasi body (400 { success:false, error }) dan
// pembuatan produk + sinkron POS (201, bentuk respons lama).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, jsonRequest } from "@/lib/purchasing/item-fake-db.test-util";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

const WAREHOUSE_ID = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("@/lib/purchasing/item-fake-db.test-util").createFakeDb>,
}));

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => state.fake!.db),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => []), queryOne: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/api/stall-scope", () => ({ getApiStallScope: vi.fn(async () => ({ mode: "all" })) }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
  validateProductWarehouseScope: vi.fn(async (warehouseId: string) => ({
    company_id: "company-1",
    branch_id: "branch-1",
    warehouse_id: warehouseId,
  })),
}));
vi.mock("@/lib/pos/purchasing-sync", () => ({
  syncPurchasingProductToPos: vi.fn(async () => ({ pos_product_id: "pos-1" })),
}));

describe("/api/purchasing/products", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("POST tanpa nama → 400 dengan pesan field pertama", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/products", { nama: "", warehouse_id: WAREHOUSE_ID })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Nama produk wajib diisi" });
  });

  it("POST kode bentrok di stall yang sama → 400", async () => {
    state.fake = createFakeDb({ products: [{ data: { id: "dup" }, error: null }] });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/products", {
        kode: "PRD-1",
        nama: "Latte",
        warehouse_id: WAREHOUSE_ID,
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Kode produk sudah digunakan di stall ini");
  });

  it("POST valid → 201, kode otomatis, tersinkron ke POS", async () => {
    state.fake = createFakeDb({
      products: [
        { data: [{ kode: "PRD-20261004-004" }], error: null },
        {
          data: { id: "p-1", kode: "x", kategori: "Coffee", station: "bar", production_output_type: "FINISHED_GOOD" },
          error: null,
        },
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/products", {
        nama: "Latte",
        kategori: "Coffee",
        station: "bar",
        warehouse_id: WAREHOUSE_ID,
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      data: { id: "p-1" },
      pos_sync: { pos_product_id: "pos-1" },
      message: "Produk berhasil ditambahkan dan tersinkron ke POS",
    });
    const insert = state.fake.calls.find((c) => c.table === "products" && c.action === "insert");
    expect(insert?.payload).toMatchObject({
      nama: "Latte",
      station: "bar",
      company_id: "company-1",
      warehouse_id: WAREHOUSE_ID,
    });
    expect((insert?.payload as { kode: string }).kode).toMatch(/^PRD-\d{8}-\d{3}$/);
  });

  it("GET → { success, data, pagination } dengan review HPP & variant_count", async () => {
    state.fake = createFakeDb({
      v_products_cogs: [
        {
          data: [{ id: "p-1", nama: "Latte", harga_modal: 1000, hpp_estimasi: 1500, total_bahan_baku: 2 }],
          error: null,
          count: 1,
        },
      ],
    });
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/products?page=1&limit=10"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: [
        expect.objectContaining({ id: "p-1", hpp_resep: 1500, hpp_perlu_review: true, variant_count: 0 }),
      ],
      pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
    });
  });
});
