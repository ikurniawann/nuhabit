import { describe, expect, it } from "vitest";
import {
  buildStockCostMap,
  costBomLines,
  fallbackMaterialCost,
  normalizeToSmallUnit,
  qtyWithWaste,
} from "./bom-cost";
import {
  productBomCreateSchema,
  productBomUpdateSchema,
  rawMaterialBomCreateSchema,
} from "./bom-schemas";

const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";

describe("bom-cost", () => {
  it("normalizeToSmallUnit membagi konversi hanya bila ada satuan kecil", () => {
    expect(normalizeToSmallUnit(12000, 12, "unit-gram")).toBe(1000);
    expect(normalizeToSmallUnit(12000, 12, null)).toBe(12000);
    expect(normalizeToSmallUnit(12000, 0, "unit-gram")).toBe(12000);
  });

  it("buildStockCostMap membaca angka string dari Postgres", () => {
    const rows = [{ id: "a", avg_cost: "5000", konversi_factor: "1000", satuan_kecil_id: "g" }];
    expect(buildStockCostMap(rows, true).get("a")).toBe(5);
    expect(buildStockCostMap(rows, false).get("a")).toBe(5000);
  });

  it("fallbackMaterialCost: avg_cost lalu harga_avg lalu harga_terakhir", () => {
    expect(fallbackMaterialCost({ harga_avg: 300, harga_terakhir: 400 }, false)).toBe(300);
    expect(fallbackMaterialCost({ harga_terakhir: 400 }, false)).toBe(400);
    expect(fallbackMaterialCost(null, true)).toBe(0);
    expect(
      fallbackMaterialCost({ harga_terakhir: 400, konversi_factor: 4, satuan_kecil_id: "g" }, true)
    ).toBe(100);
  });

  it("qtyWithWaste menambah faktor susut", () => {
    expect(qtyWithWaste({ qty_required: "10", waste_factor: "0.1" })).toBeCloseTo(11);
    expect(qtyWithWaste({})).toBe(0);
  });

  it("costBomLines menambah biaya per baris dan total", () => {
    const { lines, total } = costBomLines(
      [
        { id: "x", qty_required: 2, waste_factor: 0.5 },
        { id: "y", qty_required: 1, waste_factor: 0 },
      ],
      (line) => (line.id === "x" ? 100 : 40)
    );
    expect(lines[0]).toMatchObject({ id: "x", cost_per_unit: 100, total_cost: 300 });
    expect(lines[1]).toMatchObject({ id: "y", cost_per_unit: 40, total_cost: 40 });
    expect(total).toBe(340);
  });
});

describe("bom-schemas", () => {
  it("resep produk menerima field lama qty_needed / waste_persen", () => {
    expect(
      productBomCreateSchema.parse({ raw_material_id: MATERIAL_ID, qty_needed: 2, waste_persen: 5 })
    ).toEqual({ raw_material_id: MATERIAL_ID, qty_required: 2, satuan_id: null, waste_factor: 0.05 });
  });

  it("resep produk menolak qty kosong", () => {
    const result = productBomCreateSchema.safeParse({ raw_material_id: MATERIAL_ID });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Jumlah harus lebih dari 0");
  });

  it("update resep hanya membawa field yang dikirim", () => {
    expect(productBomUpdateSchema.parse({ waste_persen: 10 })).toEqual({ waste_factor: 0.1 });
    expect(productBomUpdateSchema.parse({ qty_needed: 3, is_active: false })).toEqual({
      qty_required: 3,
      is_active: false,
    });
  });

  it("komponen bahan baku: waste_persen jadi waste_factor", () => {
    expect(
      rawMaterialBomCreateSchema.parse({
        component_raw_material_id: MATERIAL_ID,
        qty_required: 1,
        waste_persen: 20,
      })
    ).toMatchObject({ qty_required: 1, waste_factor: 0.2, satuan_id: null });
  });
});
