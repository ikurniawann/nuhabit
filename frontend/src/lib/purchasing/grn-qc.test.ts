// EPIC-047 Fase 2 — GRN per varian. Bagian bawah file ini menguji
// `submitGrnQcInspection` end-to-end dengan db palsu (FIFO respons per
// tabel, meniru urutan pemanggilan db.from(table) persis seperti di lib):
// gerbang "produk ber-varian wajib pos_sku_id" harus melempar SEBELUM
// tulisan apa pun; SKU valid → posting per-SKU; produk tanpa varian dan
// bahan baku tetap lewat jalur lama byte demi byte.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildInlineQcItemsFromCreatedGrn,
  submitGrnQcInspection,
} from "@/lib/purchasing/grn-qc";
import { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";
import { resolveBaseUnitFactor } from "@/lib/purchasing/raw-material-units";

const addInventoryFromGrnMock = vi.fn(async () => {});
vi.mock("@/lib/inventory", () => ({
  addInventoryFromGrn: (...args: unknown[]) =>
    (addInventoryFromGrnMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const updateDeliveryStatusAfterGrnMock = vi.fn(async () => {});
const updatePOStatusAfterGrnMock = vi.fn(async () => {});
const recalculatePoReceivedQtyMock = vi.fn(async () => {});
vi.mock("@/lib/purchasing/grn", () => ({
  updateDeliveryStatusAfterGrn: (...args: unknown[]) =>
    (updateDeliveryStatusAfterGrnMock as unknown as (...a: unknown[]) => unknown)(...args),
  updatePOStatusAfterGrn: (...args: unknown[]) =>
    (updatePOStatusAfterGrnMock as unknown as (...a: unknown[]) => unknown)(...args),
  recalculatePoReceivedQty: (...args: unknown[]) =>
    (recalculatePoReceivedQtyMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const syncQcRejectCreditsMock = vi.fn(async () => {});
vi.mock("@/lib/purchasing/vendor-credit-service", () => ({
  syncQcRejectCredits: (...args: unknown[]) =>
    (syncQcRejectCreditsMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const postGrnAccountingJournalsMock = vi.fn(async () => ({ note: null }));
vi.mock("@/lib/purchasing/accounting-posting", () => ({
  postGrnAccountingJournals: (...args: unknown[]) =>
    (postGrnAccountingJournalsMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

// ---- Fake query-builder db (FIFO respons per tabel + db.rpc). ------------
type FakeResult = { data: unknown; error: unknown };

function createFakeDb(responses: Record<string, FakeResult[]>) {
  const calls: Array<{ table: string; action: string; payload?: unknown }> = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];

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
      order: () => b,
      limit: () => b,
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
      delete: () => {
        state.action = "delete";
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

  const db = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: 1, error: null };
    }),
  };
  return { db, calls, rpcCalls };
}

const GRN_ID = "grn-1";
const PO_ID = "po-1";
const baseGrn = {
  id: GRN_ID,
  nomor_grn: "GRN-001",
  status: "pending",
  purchase_order_id: PO_ID,
  delivery_id: null,
};

function baseInput(items: Parameters<typeof submitGrnQcInspection>[1]["items"]) {
  return {
    grnId: GRN_ID,
    status: "approved" as const,
    items,
    userId: "user-1",
  };
}

describe("submitGrnQcInspection — EPIC-047 Fase 2 GRN per varian", () => {
  beforeEach(() => {
    addInventoryFromGrnMock.mockClear();
    updateDeliveryStatusAfterGrnMock.mockClear();
    updatePOStatusAfterGrnMock.mockClear();
    recalculatePoReceivedQtyMock.mockClear();
    syncQcRejectCreditsMock.mockClear();
    postGrnAccountingJournalsMock.mockClear();
  });

  it("throws before any write when a variant product GRN item has no pos_sku_id", async () => {
    const { db, calls } = createFakeDb({
      grn: [{ data: baseGrn, error: null }],
      grn_qc_inspections: [{ data: null, error: null }],
      grn_items: [
        {
          data: [
            {
              id: "gi-1",
              raw_material_id: null,
              product_id: "product-variant",
              qty_diterima: 10,
              satuan_id: null,
              warehouse_id: null,
              qty_qc_posted: 0,
              purchase_order_item_id: null,
              pos_sku_id: null,
              purchase_order_item: null,
            },
          ],
          error: null,
        },
      ],
      pos_products: [
        {
          data: [{ id: "pos-product-1", source_product_id: "product-variant" }],
          error: null,
        },
      ],
      pos_product_skus: [{ data: [{ product_id: "pos-product-1" }], error: null }],
    });

    await expect(
      submitGrnQcInspection(
        db as never,
        baseInput([
          {
            grn_item_id: "gi-1",
            product_id: "product-variant",
            qty_inspected: 10,
            qty_accepted: 10,
            qty_rejected: 0,
          },
        ])
      )
    ).rejects.toMatchObject({
      message: "GRN produk ber-varian wajib menyebut SKU (pos_sku_id)",
    });

    // Gerbang melempar SEBELUM grn_qc_inspections pernah di-insert.
    expect(calls.some((c) => c.table === "grn_qc_inspections" && c.action === "insert")).toBe(
      false
    );
  });

  it("posts to pos_receive_merchandise_sku_stock when the GRN item carries pos_sku_id", async () => {
    const { db, calls, rpcCalls } = createFakeDb({
      grn: [{ data: baseGrn, error: null }, { data: null, error: null }],
      grn_qc_inspections: [
        { data: null, error: null },
        { data: { id: "insp-1" }, error: null },
        { data: null, error: null },
      ],
      grn_items: [
        {
          data: [
            {
              id: "gi-1",
              raw_material_id: null,
              product_id: "product-variant",
              qty_diterima: 10,
              satuan_id: null,
              warehouse_id: null,
              qty_qc_posted: 0,
              purchase_order_item_id: null,
              pos_sku_id: "sku-m-hitam",
              purchase_order_item: null,
            },
          ],
          error: null,
        },
        { data: null, error: null },
      ],
      pos_products: [
        {
          data: [{ id: "pos-product-1", source_product_id: "product-variant" }],
          error: null,
        },
      ],
      pos_product_skus: [{ data: [{ product_id: "pos-product-1" }], error: null }],
      grn_qc_inspection_items: [{ data: null, error: null }],
      purchase_order_items: [{ data: [{ qty_ordered: 10, qty_received: 10 }], error: null }],
    });

    const result = await submitGrnQcInspection(
      db as never,
      baseInput([
        {
          grn_item_id: "gi-1",
          product_id: "product-variant",
          qty_inspected: 10,
          qty_accepted: 10,
          qty_rejected: 0,
        },
      ])
    );

    expect(result.totalAccepted).toBe(10);
    expect(rpcCalls).toContainEqual({
      name: "pos_receive_merchandise_sku_stock",
      args: { p_sku_id: "sku-m-hitam", p_qty: 10 },
    });
    expect(rpcCalls.some((c) => c.name === "pos_receive_merchandise_stock")).toBe(false);
    expect(calls.some((c) => c.table === "grn_qc_inspections" && c.action === "insert")).toBe(
      true
    );
  });

  it("keeps the product-level rpc for a non-variant product (no pos_sku_id)", async () => {
    const { db, rpcCalls } = createFakeDb({
      grn: [{ data: baseGrn, error: null }, { data: null, error: null }],
      grn_qc_inspections: [
        { data: null, error: null },
        { data: { id: "insp-1" }, error: null },
        { data: null, error: null },
      ],
      grn_items: [
        {
          data: [
            {
              id: "gi-1",
              raw_material_id: null,
              product_id: "product-plain",
              qty_diterima: 3,
              satuan_id: null,
              warehouse_id: null,
              qty_qc_posted: 0,
              purchase_order_item_id: null,
              pos_sku_id: null,
              purchase_order_item: null,
            },
          ],
          error: null,
        },
        { data: null, error: null },
      ],
      // Produk ini TIDAK tertaut ke POS merchandise sama sekali (atau 0 SKU
      // aktif) — variantProductIds tidak berisi product-plain.
      pos_products: [{ data: [], error: null }],
      grn_qc_inspection_items: [{ data: null, error: null }],
      purchase_order_items: [{ data: [{ qty_ordered: 3, qty_received: 3 }], error: null }],
    });

    const result = await submitGrnQcInspection(
      db as never,
      baseInput([
        {
          grn_item_id: "gi-1",
          product_id: "product-plain",
          qty_inspected: 3,
          qty_accepted: 3,
          qty_rejected: 0,
        },
      ])
    );

    expect(result.totalAccepted).toBe(3);
    expect(rpcCalls).toContainEqual({
      name: "pos_receive_merchandise_stock",
      args: { p_source_product_id: "product-plain", p_qty: 3 },
    });
    expect(rpcCalls.some((c) => c.name === "pos_receive_merchandise_sku_stock")).toBe(false);
  });

  it("leaves the raw material path untouched — no guard query, no rpc call", async () => {
    const { db, rpcCalls, calls } = createFakeDb({
      grn: [{ data: baseGrn, error: null }, { data: null, error: null }],
      grn_qc_inspections: [
        { data: null, error: null },
        { data: { id: "insp-1" }, error: null },
        { data: null, error: null },
      ],
      grn_items: [
        {
          data: [
            {
              id: "gi-1",
              raw_material_id: "rm-1",
              product_id: null,
              qty_diterima: 12,
              satuan_id: "unit-pcs",
              warehouse_id: "wh-1",
              qty_qc_posted: 0,
              purchase_order_item_id: "poi-1",
              pos_sku_id: null,
              purchase_order_item: { id: "poi-1", harga_satuan: 1000 },
            },
          ],
          error: null,
        },
        { data: null, error: null },
      ],
      raw_materials: [
        {
          data: [{ id: "rm-1", satuan_besar_id: "unit-pcs", satuan_kecil_id: null, konversi_factor: 1 }],
          error: null,
        },
      ],
      raw_material_unit_conversions: [{ data: [], error: null }],
      grn_qc_inspection_items: [{ data: null, error: null }],
      purchase_order_items: [{ data: [{ qty_ordered: 12, qty_received: 12 }], error: null }],
    });

    const result = await submitGrnQcInspection(
      db as never,
      baseInput([
        {
          grn_item_id: "gi-1",
          raw_material_id: "rm-1",
          qty_inspected: 12,
          qty_accepted: 12,
          qty_rejected: 0,
        },
      ])
    );

    expect(result.totalAccepted).toBe(12);
    // Jalur bahan baku sama sekali tidak memanggil guard varian (tabel
    // pos_products/pos_product_skus tidak pernah dipanggil) maupun rpc POS.
    expect(calls.some((c) => c.table === "pos_products" || c.table === "pos_product_skus")).toBe(
      false
    );
    expect(rpcCalls).toHaveLength(0);
    expect(addInventoryFromGrnMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveBaseUnitFactor", () => {
  const material = {
    satuan_besar_id: "unit-box",
    satuan_kecil_id: "unit-pcs",
    konversi_factor: 12,
  };

  it("scales satuan besar into the base unit", () => {
    expect(resolveBaseUnitFactor(material, [], "unit-box")).toBe(12);
  });

  it("keeps satuan kecil as-is because it is the base unit", () => {
    expect(resolveBaseUnitFactor(material, [], "unit-pcs")).toBe(1);
  });

  it("prefers an explicit unit conversion row over the material conversion factor", () => {
    expect(
      resolveBaseUnitFactor(material, [{ satuan_id: "unit-pallet", qty_in_base_unit: 144 }], "unit-pallet")
    ).toBe(144);
  });

  it("falls back to satuan besar when the document has no unit", () => {
    expect(resolveBaseUnitFactor(material, [], null)).toBe(12);
  });

  it("returns 1 when the material has no small unit", () => {
    expect(
      resolveBaseUnitFactor(
        { satuan_besar_id: "unit-kg", satuan_kecil_id: null, konversi_factor: 25 },
        [],
        "unit-kg"
      )
    ).toBe(1);
  });
});

describe("buildInlineQcItemsFromCreatedGrn", () => {
  it("maps created GRN lines to QC payload using request QC quantities", () => {
    const items = buildInlineQcItemsFromCreatedGrn({
      createdItems: [
        {
          id: "gi-1",
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 10,
        },
        {
          id: "gi-2",
          purchase_order_item_id: "poi-2",
          product_id: "p-1",
          qty_diterima: 5,
        },
        {
          id: "gi-3",
          purchase_order_item_id: "poi-3",
          raw_material_id: "rm-2",
          qty_diterima: 0,
        },
      ],
      requestItems: [
        {
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 10,
          qty_accepted: 8,
          qty_rejected: 2,
        },
        {
          purchase_order_item_id: "poi-2",
          product_id: "p-1",
          qty_diterima: 5,
          qty_accepted: 5,
          qty_rejected: 0,
        },
        {
          purchase_order_item_id: "poi-3",
          raw_material_id: "rm-2",
          qty_diterima: 0,
          qty_accepted: 0,
          qty_rejected: 0,
        },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      grn_item_id: "gi-1",
      raw_material_id: "rm-1",
      qty_inspected: 10,
      qty_accepted: 8,
      qty_rejected: 2,
    });
    expect(items[1]).toMatchObject({
      grn_item_id: "gi-2",
      product_id: "p-1",
      qty_inspected: 5,
      qty_accepted: 5,
      qty_rejected: 0,
    });
    expect(resolveOverallQcStatus(items)).toBe("partial");
  });

  it("defaults accepted to received when QC fields omitted", () => {
    const items = buildInlineQcItemsFromCreatedGrn({
      createdItems: [
        {
          id: "gi-1",
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 3,
        },
      ],
      requestItems: [
        {
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 3,
        },
      ],
    });

    expect(items[0]).toMatchObject({
      qty_accepted: 3,
      qty_rejected: 0,
    });
    expect(resolveOverallQcStatus(items)).toBe("approved");
  });
});
