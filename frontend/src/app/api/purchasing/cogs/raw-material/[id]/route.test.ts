import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefixMock = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: () => requireIamMenuPrefixMock(),
}));

type FakeResult = { data: unknown; error: unknown };

function createFakeDb(responses: Record<string, FakeResult[]>) {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "order", "single", "maybeSingle"]) b[method] = () => b;
    b.then = (resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) => {
      const next = responses[table]?.shift();
      if (!next) return Promise.reject(new Error(`no mock response for ${table}`)).catch(reject);
      return Promise.resolve(next).then(resolve, reject);
    };
    return b;
  }
  return { from: vi.fn((table: string) => builder(table)) };
}

// Landed cost reads (receipts, document totals, additional costs) run raw SQL.
const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

let fakeDb: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => fakeDb),
}));

const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const call = async (id: string) => {
  const { GET } = await import("./route");
  return GET({} as NextRequest, { params: Promise.resolve({ id }) });
};

beforeEach(() => {
  vi.clearAllMocks();
  requireIamMenuPrefixMock.mockResolvedValue({ id: "user-1", role: "admin" });
  fakeDb = createFakeDb({});
  queryMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/purchasing/cogs/raw-material/[id]", () => {
  it("400 { success: false, error } for a non-uuid id, before touching the db", async () => {
    const res = await call("abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Invalid raw material ID" });
    expect(fakeDb.from).not.toHaveBeenCalled();
  });

  it("keeps the session guard: 401 without a user", async () => {
    requireIamMenuPrefixMock.mockRejectedValue(ApiError.unauthorized());
    const res = await call(MATERIAL_ID);
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });

  it("404 when the raw material does not exist", async () => {
    fakeDb = createFakeDb({ v_raw_materials_stock: [{ data: null, error: null }] });
    const res = await call(MATERIAL_ID);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Raw material not found");
  });

  it("estimates COGS from the BOM components plus landed cost and overhead", async () => {
    // 10000 freight on a GRN that received 100000 of sugar: 10% landed cost.
    queryMock
      .mockResolvedValueOnce([{ grn_id: "g1", po_id: "p1", material_id: "rm-gula", value: 100000 }])
      .mockResolvedValueOnce([
        { key: "GRN:g1", value: 100000 },
        { key: "PO:p1", value: 100000 },
      ])
      .mockResolvedValueOnce([{ reference_type: "GRN", reference_id: "g1", amount: 10000 }]);
    fakeDb = createFakeDb({
      v_raw_materials_stock: [
        { data: { id: MATERIAL_ID, kode: "SYR", nama: "Sirup" }, error: null },
        {
          data: [{ id: "rm-gula", qty_onhand: "40", qty_on_order: 0, avg_cost: "15000", satuan_kecil_nama: "gr" }],
          error: null,
        },
      ],
      raw_material_bom_items: [
        {
          data: [
            {
              component_raw_material_id: "rm-gula",
              qty_required: "2",
              waste_factor: "0.5",
              component: { kode: "GULA", nama: "Gula", material_type: null },
              satuan: null,
            },
          ],
          error: null,
        },
      ],
      settings: [{ data: { value: "20" }, error: null }],
    });

    const res = await call(MATERIAL_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      raw_material_id: MATERIAL_ID,
      kode: "SYR",
      nama: "Sirup",
      hpp_per_unit: 59400,
      total_bom_cost: 45000,
      total_additional_cost: 4500,
      overhead_rate: 20,
      total_overhead: 9900,
      breakdown_bahan: [
        {
          bahan_id: "rm-gula",
          kode: "GULA",
          nama: "Gula",
          material_type: "PURCHASED",
          jumlah: 2,
          satuan: "gr",
          qty_available: 40,
          qty_on_order: 0,
          unit_cost: 15000,
          waste_percentage: 50,
          effective_qty: 3,
          subtotal: 45000,
          landed_cost_rate: 10,
          additional_cost: 4500,
        },
      ],
    });
  });
});
