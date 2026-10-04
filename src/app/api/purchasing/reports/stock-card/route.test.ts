// EPIC-047 Fase 1B (perbaikan double-count) — GET .../reports/stock-card
// item_type=product: baris rincian per varian (pos_sku_id terisi) tidak boleh
// ikut dihitung di kartu stok level produk (double-count total_in & rusak
// rantai qty_before/qty_after). Lihat fix di route.ts (.is("pos_sku_id", null)).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", role: "admin" })),
}));

vi.mock("@/lib/api/stall-scope", () => ({
  resolveWarehouseFilter: vi.fn(async (explicit?: string | null) => explicit ?? null),
}));

type FilterCall = { method: string; col: string; value: unknown };

// Fake query-builder db: setiap .eq()/.is() dicatat sebagai filter dan
// benar-benar DITERAPKAN ke dataset tabel (bukan sekadar dicatat) — supaya
// tes ini membuktikan PERILAKU nyata (baris pos_sku_id != null tersaring),
// bukan cuma bahwa method-nya dipanggil.
function createFakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; filters: FilterCall[] }> = [];

  function matches(row: Record<string, unknown>, filter: FilterCall) {
    if (filter.method === "eq") return String(row[filter.col]) === String(filter.value);
    if (filter.method === "is") {
      if (filter.value === null) return row[filter.col] === null || row[filter.col] === undefined;
      return row[filter.col] === filter.value;
    }
    return true; // gte/lte/order/limit/or tidak relevan untuk tes ini
  }

  function builder(table: string) {
    const filters: FilterCall[] = [];
    const b: Record<string, unknown> = {};
    const record = (method: string) => (col: string, value: unknown) => {
      filters.push({ method, col, value });
      return b;
    };
    b.select = () => b;
    b.eq = record("eq");
    b.is = record("is");
    b.gte = record("gte");
    b.lte = record("lte");
    b.in = record("in");
    b.order = () => b;
    b.limit = () => b;
    b.or = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      calls.push({ table, filters: [...filters] });
      const rows = tables[table] || [];
      const filtered = rows.filter((row) => filters.every((f) => matches(row, f)));
      return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
    };
    return b;
  }

  return { db: { from: (table: string) => builder(table) }, calls };
}

let fakeDbRef: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: vi.fn(() => fakeDbRef.db),
}));

function makeRequest(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/purchasing/reports/stock-card");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { url: url.toString() } as unknown as NextRequest;
}

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SKU_XL = "22222222-2222-4222-8222-222222222222";
const SKU_L = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET .../reports/stock-card — item_type=product tidak double-count baris varian", () => {
  it("total_in & closing_balance hanya dari baris level produk (pos_sku_id IS NULL)", async () => {
    fakeDbRef = createFakeDb({
      v_finished_goods_stock: [
        {
          product_id: PRODUCT_ID,
          product_kode: "KAOS-001",
          product_nama: "Kaos Polos",
          product_kategori: "Merchandise",
          satuan_nama: "pcs",
          warehouse_id: "wh-1",
          warehouse_name: "Gudang Utama",
          qty_available: 180,
          unit_cost: 25000,
          is_active: true,
        },
      ],
      finished_goods_movements: [
        {
          id: "mv-product",
          product_id: PRODUCT_ID,
          warehouse_id: "wh-1",
          tipe: "in",
          jumlah: 100,
          qty_before: 80,
          qty_after: 180,
          unit_cost: 25000,
          total_cost: 2500000,
          reference_type: "production_order",
          reference_id: ORDER_ID,
          reference_number: "PROD-001",
          alasan: "Production completed",
          catatan: null,
          pos_sku_id: null,
          is_active: true,
          created_at: "2026-09-10T01:00:00.000Z",
        },
        {
          id: "mv-varian-l",
          product_id: PRODUCT_ID,
          warehouse_id: "wh-1",
          tipe: "in",
          jumlah: 50,
          qty_before: 0,
          qty_after: 50,
          unit_cost: 25000,
          total_cost: 1250000,
          reference_type: "production_order",
          reference_id: ORDER_ID,
          reference_number: "PROD-001",
          alasan: "Production completed",
          catatan: "rincian varian",
          pos_sku_id: SKU_L,
          is_active: true,
          created_at: "2026-09-10T01:00:01.000Z",
        },
        {
          id: "mv-varian-xl",
          product_id: PRODUCT_ID,
          warehouse_id: "wh-1",
          tipe: "in",
          jumlah: 50,
          qty_before: 0,
          qty_after: 50,
          unit_cost: 25000,
          total_cost: 1250000,
          reference_type: "production_order",
          reference_id: ORDER_ID,
          reference_number: "PROD-001",
          alasan: "Production completed",
          catatan: "rincian varian",
          pos_sku_id: SKU_XL,
          is_active: true,
          created_at: "2026-09-10T01:00:02.000Z",
        },
      ],
    });

    const { GET } = await import("./route");
    const res = await GET(makeRequest({ item_type: "product", product_id: PRODUCT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    // Hanya baris produk yang lolos — 2 baris varian tersaring.
    expect(body.data.movements).toHaveLength(1);
    expect(body.data.movements[0].id).toBe("mv-product");
    expect(body.data.summary.total_in).toBe(100); // BUKAN 200
    expect(body.data.summary.closing_balance).toBe(180);
    expect(body.data.summary.movement_count).toBe(1);

    // Bukti langsung: filter pos_sku_id IS NULL benar-benar dikirim ke query
    // finished_goods_movements.
    const movementsCall = fakeDbRef.calls.find((c) => c.table === "finished_goods_movements");
    expect(movementsCall?.filters).toContainEqual({
      method: "is",
      col: "pos_sku_id",
      value: null,
    });
  });

  it("400 { success: false, error } for an invalid item_type", async () => {
    fakeDbRef = createFakeDb({});
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ item_type: "service" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid query params");
  });
});
