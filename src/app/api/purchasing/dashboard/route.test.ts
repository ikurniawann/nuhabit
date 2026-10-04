import { beforeEach, describe, expect, it, vi } from "vitest";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

vi.mock("@/lib/api/stall-scope", () => ({
  rawMaterialStockSource: vi.fn(async () => ({ view: "v_raw_materials_stock", warehouseId: null })),
}));

type FakeResult = { data?: unknown; error?: unknown; count?: number | null };

// Fake query builder: respons FIFO per tabel, urutan sama dengan pemanggilan di lib.
function createFakeDb(responses: Record<string, FakeResult[]>) {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "or", "gte", "lte", "order", "limit"]) b[method] = () => b;
    b.then = (resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) => {
      const next = responses[table]?.shift();
      if (!next) return Promise.reject(new Error(`no mock response for ${table}`)).catch(reject);
      return Promise.resolve({ data: null, error: null, count: null, ...next }).then(resolve, reject);
    };
    return b;
  }
  return { from: vi.fn((table: string) => builder(table)) };
}

let fakeDb: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => fakeDb),
}));

const request = (query = "") => new Request(`http://localhost/api/purchasing/dashboard${query}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/purchasing/dashboard", () => {
  it("returns the PurchasingDashboardData shape", async () => {
    fakeDb = createFakeDb({
      v_purchase_orders: [
        { data: [{ id: "a", grand_total: "300000" }, { id: "b", total: 100000 }] }, // periode ini
        { data: [{ id: "c", grand_total: 200000 }] }, // periode lalu
        { count: 4 }, // pending approval
        {
          data: [
            { id: "po-1", nomor_po: "PO-1", tanggal_po: "2026-09-01", tanggal_kirim_estimasi: null, status: "sent", nama_supplier: null },
          ],
        },
        { data: [{ created_at: "2026-09-10T00:00:00Z", source_type: "pr", grand_total: 100 }] },
      ],
      v_raw_materials_stock: [
        { count: 2 },
        { data: [{ id: "rm-1", nama: "Gula", kategori: null, qty_onhand: 0, min_stock: 5, satuan: "kg" }] },
      ],
      suppliers: [{ data: [{ id: "s-1", nama_supplier: "Alpha" }] }],
    });

    const { GET } = await import("./route");
    const res = await GET(request("?start_date=2026-09-01&end_date=2026-09-30"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(
      ["actionPOs", "hppTrends", "kpis", "monthlyTrends", "stockAlerts", "supplierPerformance"].sort()
    );
    expect(body.kpis).toEqual({
      totalPOCount: 2,
      totalPOCountChange: 100,
      totalPOValue: 400000,
      totalPOValueChange: 100,
      lowStockCount: 2,
      pendingApprovalCount: 4,
    });
    expect(body.actionPOs[0]).toMatchObject({ po_number: "PO-1", supplier_name: "Unknown", days_overdue: 0 });
    expect(body.stockAlerts[0]).toMatchObject({ category: "Uncategorized", alert_level: "critical", minimum_stok: 5 });
    expect(body.monthlyTrends).toEqual([{ month: "Sep", pr: 100 }]);
    expect(body.supplierPerformance[0]).toMatchObject({ supplier_id: "s-1", on_time_rate: 85 });
  });

  it("answers 500 with { success: false, error } when the KPI query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb = createFakeDb({
      v_purchase_orders: [{ error: { message: "boom" } }, { data: [] }, { count: 0 }],
      v_raw_materials_stock: [{ count: 0 }],
    });

    const { GET } = await import("./route");
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Terjadi kesalahan server" });
  });
});
