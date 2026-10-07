import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", role: "admin" })),
}));

vi.mock("@/lib/api/scope", () => ({
  getApiUserScope: vi.fn(async () => null),
  companyScopeOr: vi.fn(() => null),
  branchScopeOr: vi.fn(() => null),
  effectiveCompanyId: vi.fn(() => "company-1"),
  effectiveBranchId: vi.fn(() => "branch-1"),
}));

type FakeResult = { data: unknown; error: unknown };

function createFakeDb(responses: Record<string, FakeResult[]>) {
  const writes: Array<{ table: string; payload: unknown }> = [];
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "ilike", "order", "limit", "single"]) b[method] = () => b;
    b.insert = (payload: unknown) => {
      writes.push({ table, payload });
      return b;
    };
    b.then = (resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) => {
      const next = responses[table]?.shift();
      if (!next) return Promise.reject(new Error(`no mock response for ${table}`)).catch(reject);
      return Promise.resolve(next).then(resolve, reject);
    };
    return b;
  }
  return { db: { from: vi.fn((table: string) => builder(table)) }, writes };
}

let fake: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: vi.fn(() => fake.db),
}));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST({ json: async () => body } as unknown as NextRequest);
};

const OUTPUT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb({});
});

describe("POST /api/purchasing/production/orders", () => {
  it("400 { success: false, error } when a product order has no product_id", async () => {
    const res = await post({ planned_qty: 5 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: "Validation failed" });
    expect(fake.db.from).not.toHaveBeenCalled();
  });

  it("400 when the output raw material has no BOM", async () => {
    fake = createFakeDb({
      raw_materials: [{ data: { id: OUTPUT_ID, kode: "SYR", nama: "Sirup" }, error: null }],
      raw_material_bom_items: [{ data: [], error: null }],
    });
    const res = await post({ production_context: "raw_material", raw_material_id: OUTPUT_ID, planned_qty: 2 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bill of materials/);
  });

  it("201 creates a DRAFT raw-material order with planned costs", async () => {
    fake = createFakeDb({
      raw_materials: [{ data: { id: OUTPUT_ID, company_id: null, branch_id: "branch-9" }, error: null }],
      raw_material_bom_items: [
        { data: [{ component_raw_material_id: "rm-1", satuan_id: "u-1", qty_required: "1", waste_factor: "0" }], error: null },
      ],
      v_raw_materials_stock: [{ data: [{ id: "rm-1", avg_cost: "2500" }], error: null }],
      production_orders: [
        { data: [{ nomor_produksi: "PROD-202610-0007" }], error: null },
        { data: { id: "order-1", nomor_produksi: "PROD-202610-0008" }, error: null },
      ],
      production_order_materials: [{ data: null, error: null }],
    });

    const res = await post({ production_context: "raw_material", raw_material_id: OUTPUT_ID, planned_qty: 4, labor_cost: 1000 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/^Production order PROD-\d{6}-\d{4} created successfully$/);
    expect(body.data).toMatchObject({ id: "order-1", materials: [{ raw_material_id: "rm-1", qty_planned: 4, total_cost: 10000 }] });

    const orderInsert = fake.writes.find((w) => w.table === "production_orders")?.payload as Record<string, unknown>;
    expect(orderInsert).toMatchObject({
      production_context: "raw_material",
      status: "DRAFT",
      company_id: "company-1",
      branch_id: "branch-9",
      planned_material_cost: 10000,
      hpp_per_unit: 2750,
    });
  });
});
