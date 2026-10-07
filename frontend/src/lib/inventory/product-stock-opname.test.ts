// EPIC-047 Fase 3 — jahitan "stock opname per SKU". Test murni (tanpa I/O)
// untuk dua helper yang dipakai listProductInventoryForOpname (preview) dan
// rute complete: ekspansi baris per SKU, dan Σ-selisih per produk ber-varian.
import { describe, expect, it } from "vitest";
import {
  expandOpnameLinesBySku,
  summarizeOpnameSkuDeltas,
  type OpnameCompleteLineInput,
  type OpnameSkuOption,
  type ProductOpnamePreviewLine,
} from "./product-stock-opname";

function baseRow(overrides: Partial<ProductOpnamePreviewLine> = {}): ProductOpnamePreviewLine {
  return {
    inventory_id: "inv-1",
    product_id: "product-1",
    product_kode: "KAOS-001",
    product_nama: "Kaos Sulu Basic",
    satuan: "PCS",
    qty_system: 40,
    unit_cost: 25000,
    ...overrides,
  };
}

describe("expandOpnameLinesBySku", () => {
  it("produk dengan 3 SKU aktif → 3 baris, masing-masing pakai stok SKU", () => {
    const rows = [baseRow()];
    const skus: OpnameSkuOption[] = [
      { pos_sku_id: "sku-l", pos_sku_code: "KAOS-001-L-HTM", pos_sku_name: "L / Hitam", stock_quantity: 10 },
      { pos_sku_id: "sku-m", pos_sku_code: "KAOS-001-M-HTM", pos_sku_name: "M / Hitam", stock_quantity: 15 },
      { pos_sku_id: "sku-s", pos_sku_code: "KAOS-001-S-PTH", pos_sku_name: "S / Putih", stock_quantity: 5 },
    ];
    const map = new Map([["product-1", skus]]);

    const result = expandOpnameLinesBySku(rows, map);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.pos_sku_id)).toEqual(["sku-l", "sku-m", "sku-s"]);
    expect(result.map((r) => r.qty_system)).toEqual([10, 15, 5]);
    // field produk tetap sama di setiap baris SKU
    for (const line of result) {
      expect(line.product_id).toBe("product-1");
      expect(line.product_kode).toBe("KAOS-001");
      expect(line.inventory_id).toBe("inv-1");
      expect(line.unit_cost).toBe(25000);
    }
    expect(result[0].pos_sku_code).toBe("KAOS-001-L-HTM");
    expect(result[0].pos_sku_name).toBe("L / Hitam");
  });

  it("produk tanpa SKU (peta kosong) → 1 baris, tidak berubah", () => {
    const rows = [baseRow({ product_id: "product-2", product_kode: "KAOS-003" })];
    const map = new Map<string, OpnameSkuOption[]>();

    const result = expandOpnameLinesBySku(rows, map);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(rows[0]);
    expect(result[0].pos_sku_id).toBeUndefined();
  });

  it("urutan produk asal + urutan SKU dijaga stabil (campuran ber-SKU dan tidak)", () => {
    const rows = [
      baseRow({ product_id: "product-a", product_kode: "AAA" }),
      baseRow({ product_id: "product-b", product_kode: "BBB" }),
      baseRow({ product_id: "product-c", product_kode: "CCC" }),
    ];
    const map = new Map<string, OpnameSkuOption[]>([
      [
        "product-b",
        [
          { pos_sku_id: "sku-b1", pos_sku_code: "BBB-1", pos_sku_name: "B1", stock_quantity: 1 },
          { pos_sku_id: "sku-b2", pos_sku_code: "BBB-2", pos_sku_name: "B2", stock_quantity: 2 },
        ],
      ],
    ]);

    const result = expandOpnameLinesBySku(rows, map);

    expect(result.map((r) => r.product_kode)).toEqual(["AAA", "BBB", "BBB", "CCC"]);
    expect(result.map((r) => r.pos_sku_id ?? null)).toEqual([null, "sku-b1", "sku-b2", null]);
  });

  it("SKU aktif tapi array kosong pada map → diperlakukan sama seperti tanpa SKU", () => {
    const rows = [baseRow()];
    const map = new Map<string, OpnameSkuOption[]>([["product-1", []]]);

    const result = expandOpnameLinesBySku(rows, map);

    expect(result).toHaveLength(1);
    expect(result[0].pos_sku_id).toBeUndefined();
  });
});

describe("summarizeOpnameSkuDeltas", () => {
  function skuLine(overrides: Partial<OpnameCompleteLineInput> = {}): OpnameCompleteLineInput {
    return {
      id: "line-1",
      product_id: "product-1",
      pos_sku_id: "sku-1",
      qty_before: 10,
      qty_counted: 10,
      ...overrides,
    };
  }

  it("baris campuran: SKU +/- dan produk non-varian → agregat & jalur terpisah benar", () => {
    const lines: OpnameCompleteLineInput[] = [
      skuLine({ id: "l-m", pos_sku_id: "sku-m", qty_before: 20, qty_counted: 18 }), // -2
      skuLine({ id: "l-s", pos_sku_id: "sku-s", qty_before: 5, qty_counted: 6 }), // +1
      skuLine({ id: "l-l", pos_sku_id: "sku-l", qty_before: 8, qty_counted: 8 }), // 0
      {
        id: "l-non-variant",
        product_id: "product-2",
        pos_sku_id: null,
        qty_before: 12,
        qty_counted: 15,
      },
    ];

    const result = summarizeOpnameSkuDeltas(lines);

    expect(result.skuLines).toHaveLength(3);
    expect(result.skuLines.find((l) => l.id === "l-m")?.delta).toBe(-2);
    expect(result.skuLines.find((l) => l.id === "l-s")?.delta).toBe(1);
    expect(result.skuLines.find((l) => l.id === "l-l")?.delta).toBe(0);

    expect(result.productLines).toHaveLength(1);
    expect(result.productLines[0]).toMatchObject({
      id: "l-non-variant",
      product_id: "product-2",
      delta: 3,
    });

    // Σ varian produk-1 = -2 + 1 + 0 = -1
    expect(result.productDeltas).toEqual([{ product_id: "product-1", delta: -1 }]);
  });

  it("produk ber-varian dengan Σ selisih 0 di-skip dari productDeltas", () => {
    const lines: OpnameCompleteLineInput[] = [
      skuLine({ id: "l-1", pos_sku_id: "sku-1", qty_before: 10, qty_counted: 8 }), // -2
      skuLine({ id: "l-2", pos_sku_id: "sku-2", qty_before: 5, qty_counted: 7 }), // +2
    ];

    const result = summarizeOpnameSkuDeltas(lines);

    expect(result.skuLines.map((l) => l.delta)).toEqual([-2, 2]);
    expect(result.productDeltas).toEqual([]);
  });

  it("produk tanpa varian sama sekali (semua baris pos_sku_id null) → semua masuk productLines", () => {
    const lines: OpnameCompleteLineInput[] = [
      { id: "l-1", product_id: "product-x", pos_sku_id: null, qty_before: 100, qty_counted: 102 },
    ];

    const result = summarizeOpnameSkuDeltas(lines);

    expect(result.skuLines).toEqual([]);
    expect(result.productLines).toHaveLength(1);
    expect(result.productDeltas).toEqual([]);
  });

  it("guard: produk punya baris SKU sekaligus baris level produk → throw", () => {
    const lines: OpnameCompleteLineInput[] = [
      skuLine({ id: "l-sku", pos_sku_id: "sku-1" }),
      {
        id: "l-product",
        product_id: "product-1",
        pos_sku_id: null,
        qty_before: 40,
        qty_counted: 40,
      },
    ];

    expect(() => summarizeOpnameSkuDeltas(lines)).toThrow(
      /punya baris SKU dan baris level produk sekaligus/
    );
  });
});
