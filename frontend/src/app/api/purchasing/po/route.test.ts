// EPIC-047 Fase 2 — POST /api/purchasing/po (module_type "product") validasi
// baris PO produk ber-varian terhadap SKU merchandise SEBELUM insert apa pun.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

vi.mock("@/lib/api/scope", () => ({
  getApiUserScope: vi.fn(async () => ({
    userId: "user-1",
    role: "admin",
    businessScope: "branch",
    holdingId: "holding-1",
    companyId: "company-1",
    branchId: "branch-1",
    isUnscoped: false,
  })),
  companyScopeOr: vi.fn(() => null),
  branchScopeOr: vi.fn(() => null),
  effectiveCompanyId: vi.fn(() => "company-1"),
  effectiveBranchId: vi.fn(() => "branch-1"),
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
      in: () => b,
      or: () => b,
      is: () => b,
      neq: () => b,
      ilike: () => b,
      order: () => b,
      limit: () => b,
      range: () => b,
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
  createServerPgClient: vi.fn(async () => fakeDbRef.db),
}));

let fakeDbRef: ReturnType<typeof createFakeDb>;

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const KAOS_001 = "11111111-1111-4111-8111-111111111111";
const KAOS_003 = "33333333-3333-4333-8333-333333333333";
const VENDOR_ID = "99999999-9999-4999-8999-999999999999";
const SKU_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SKU_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POS_PRODUCT_1 = "pos-product-kaos-001";

const basePayload = {
  module_type: "product",
  vendor_id: VENDOR_ID,
  tanggal_po: "2026-09-10",
};

describe("POST /api/purchasing/po — variant SKU validation (EPIC-047 Fase 2)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects a variant product line without pos_sku_id (400)", async () => {
    fakeDbRef = createFakeDb({
      pos_products: [
        { data: [{ id: POS_PRODUCT_1, source_product_id: KAOS_001 }], error: null },
      ],
      pos_product_skus: [
        {
          data: [
            { id: SKU_A, product_id: POS_PRODUCT_1, is_active: true },
            { id: SKU_B, product_id: POS_PRODUCT_1, is_active: true },
          ],
          error: null,
        },
      ],
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...basePayload,
        items: [{ product_id: KAOS_001, qty_ordered: 5, harga_satuan: 1000 }],
      })
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: "Produk ber-varian wajib memilih SKU" });
    // Gagal SEBELUM insert apa pun.
    expect(fakeDbRef.calls.some((c) => c.table === "purchase_orders")).toBe(false);
  });

  it("rejects a SKU id that does not belong to the requested product (400)", async () => {
    fakeDbRef = createFakeDb({
      pos_products: [
        { data: [{ id: POS_PRODUCT_1, source_product_id: KAOS_001 }], error: null },
      ],
      pos_product_skus: [
        {
          data: [{ id: SKU_A, product_id: POS_PRODUCT_1, is_active: true }],
          error: null,
        },
      ],
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...basePayload,
        items: [
          {
            product_id: KAOS_001,
            pos_sku_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", // SKU produk lain / tak dikenal
            qty_ordered: 5,
            harga_satuan: 1000,
          },
        ],
      })
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Varian tidak sesuai produk");
    expect(fakeDbRef.calls.some((c) => c.table === "purchase_orders")).toBe(false);
  });

  it("rejects a duplicate product+SKU line (400)", async () => {
    fakeDbRef = createFakeDb({
      pos_products: [
        { data: [{ id: POS_PRODUCT_1, source_product_id: KAOS_001 }], error: null },
      ],
      pos_product_skus: [
        {
          data: [{ id: SKU_A, product_id: POS_PRODUCT_1, is_active: true }],
          error: null,
        },
      ],
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...basePayload,
        items: [
          { product_id: KAOS_001, pos_sku_id: SKU_A, qty_ordered: 5, harga_satuan: 1000 },
          { product_id: KAOS_001, pos_sku_id: SKU_A, qty_ordered: 3, harga_satuan: 1000 },
        ],
      })
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Baris SKU ganda");
  });

  it("creates the PO and writes pos_sku_id on variant lines (201)", async () => {
    fakeDbRef = createFakeDb({
      pos_products: [
        { data: [{ id: POS_PRODUCT_1, source_product_id: KAOS_001 }], error: null },
      ],
      pos_product_skus: [
        {
          data: [
            { id: SKU_A, product_id: POS_PRODUCT_1, is_active: true },
            { id: SKU_B, product_id: POS_PRODUCT_1, is_active: true },
          ],
          error: null,
        },
      ],
      purchase_orders: [
        { data: [], error: null }, // generateNomorPO — belum ada nomor bulan ini
        {
          data: { id: "po-1", nomor_po: "PO-202609-0001" },
          error: null,
        },
      ],
      purchase_order_items: [{ data: null, error: null }],
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...basePayload,
        items: [
          { product_id: KAOS_001, pos_sku_id: SKU_A, qty_ordered: 5, harga_satuan: 1000 },
          { product_id: KAOS_001, pos_sku_id: SKU_B, qty_ordered: 7, harga_satuan: 1000 },
          { product_id: KAOS_003, qty_ordered: 3, harga_satuan: 2000 },
        ],
      })
    );

    expect(res.status).toBe(201);

    const itemsInsertCall = fakeDbRef.calls.find(
      (c) => c.table === "purchase_order_items" && c.action === "insert"
    );
    expect(itemsInsertCall).toBeDefined();
    const insertedItems = itemsInsertCall!.payload as Array<{
      product_id: string;
      pos_sku_id: string | null;
    }>;
    expect(insertedItems).toEqual([
      expect.objectContaining({ product_id: KAOS_001, pos_sku_id: SKU_A }),
      expect.objectContaining({ product_id: KAOS_001, pos_sku_id: SKU_B }),
      expect.objectContaining({ product_id: KAOS_003, pos_sku_id: null }),
    ]);
  });
  it("rejects a raw-material PO without an approved PR before any query (400)", async () => {
    fakeDbRef = createFakeDb({});
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        supplier_id: VENDOR_ID,
        tanggal_po: "2026-09-10",
        items: [{ raw_material_id: KAOS_001, qty_ordered: 1, harga_satuan: 1000 }],
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Purchase order must be created from an approved purchase request",
    });
    expect(fakeDbRef.calls).toEqual([]);
  });
});
