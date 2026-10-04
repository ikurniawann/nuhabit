// Route test inventory: stok bahan baku (200), supply tanpa scope (401),
// galat bisnis transfer → 400, riwayat transfer memakai pagination.total_pages.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, jsonRequest } from "@/lib/purchasing/item-fake-db.test-util";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const DEST = "22222222-2222-4222-8222-222222222222";
const MATERIAL = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("@/lib/purchasing/item-fake-db.test-util").createFakeDb>,
  scope: null as unknown,
}));

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => state.fake!.db),
}));
vi.mock("@/lib/api/stall-scope", () => ({
  rawMaterialStockSource: vi.fn(async () => ({ view: "v_raw_materials_stock", warehouseId: null })),
}));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => state.scope),
  validateWarehouseForReceivingScope: vi.fn(async () => ({ branch_id: "branch-1" })),
}));
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({
    id: "user-1",
    full_name: "Admin",
    role: "admin",
    brand_id: null,
  })),
}));
vi.mock("@/lib/inventory/stock-transfer", () => ({
  executeStockTransfer: vi.fn(async () => {
    throw new Error("Insufficient stock. Available: 2");
  }),
  listStockTransfers: vi.fn(async () => ({ rows: [{ id: "t-1" }], total: 21 })),
}));
vi.mock("@/lib/audit", () => ({
  recordAuditAfterCommit: vi.fn(async () => undefined),
  requestMeta: vi.fn(() => ({ ip: null, userAgent: null })),
}));

describe("/api/purchasing/inventory", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
    state.scope = null;
  });

  it("GET stok bahan baku → { success, data }", async () => {
    state.fake = createFakeDb({ v_raw_materials_stock: [{ data: [{ id: MATERIAL }], error: null }] });
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/inventory?below_minimum=true"));
    expect(await res.json()).toEqual({ success: true, data: [{ id: MATERIAL }] });
    expect(state.fake!.calls[0].filters).toContainEqual(["or", "status_stok.eq.MENIPIS,status_stok.eq.HABIS"]);
  });

  it("GET supply tanpa scope sesi → 401", async () => {
    const { GET } = await import("./supply/route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/inventory/supply"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
  });

  it("POST transfer stok kurang → 400 dengan pesan executeStockTransfer", async () => {
    state.fake = createFakeDb({ raw_materials: [{ data: null, error: null }] });
    const { POST } = await import("./transfer/route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/inventory/transfer", {
        transfer_kind: "main_to_stall",
        source_warehouse_id: SOURCE,
        dest_warehouse_id: DEST,
        raw_material_id: MATERIAL,
        qty: 5,
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient stock. Available: 2" });
  });

  it("POST transfer qty 0 → 400 validasi", async () => {
    const { POST } = await import("./transfer/route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/inventory/transfer", {
        transfer_kind: "main_to_stall",
        source_warehouse_id: SOURCE,
        dest_warehouse_id: DEST,
        raw_material_id: MATERIAL,
        qty: 0,
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Quantity must be greater than zero");
  });

  it("GET transfer → pagination.total_pages (bentuk lama klien)", async () => {
    const { GET } = await import("./transfer/route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/inventory/transfer?limit=10"));
    expect(await res.json()).toEqual({
      success: true,
      data: [{ id: "t-1" }],
      pagination: { page: 1, limit: 10, total: 21, total_pages: 3 },
    });
  });
});
