import { describe, expect, it } from "vitest";
import { findShortfalls, planDeductions } from "./realization";

const stock = [
  { id: "inv-a1", raw_material_id: "gula", warehouse_id: "w1", qty_available: 3 },
  { id: "inv-a2", raw_material_id: "gula", warehouse_id: "w2", qty_available: 5 },
  { id: "inv-b1", raw_material_id: "kopi", warehouse_id: "w1", qty_available: 1.2 },
];

describe("findShortfalls", () => {
  it("menjumlah stok semua gudang per bahan", () => {
    expect(findShortfalls([{ raw_material_id: "gula", needed: 8 }], stock)).toEqual([]);
    expect(findShortfalls([{ raw_material_id: "gula", needed: 8.5 }], stock)).toEqual([
      { raw_material_id: "gula", needed: 8.5, available: 8 },
    ]);
  });

  it("bahan tanpa baris stok = tersedia 0", () => {
    expect(findShortfalls([{ raw_material_id: "susu", needed: 2 }], stock)).toEqual([
      { raw_material_id: "susu", needed: 2, available: 0 },
    ]);
  });

  it("drift float di bawah presisi 3 desimal tidak memblokir", () => {
    expect(findShortfalls([{ raw_material_id: "kopi", needed: 1.2000000001 }], stock)).toEqual([]);
  });
});

describe("planDeductions", () => {
  it("memotong gudang terbesar dulu sampai kebutuhan terpenuhi", () => {
    expect(planDeductions([{ raw_material_id: "gula", needed: 6 }], stock)).toEqual([
      { inventory_id: "inv-a2", raw_material_id: "gula", warehouse_id: "w2", take: 5, before: 5, after: 0 },
      { inventory_id: "inv-a1", raw_material_id: "gula", warehouse_id: "w1", take: 1, before: 3, after: 2 },
    ]);
  });

  it("satu baris cukup = satu pergerakan", () => {
    expect(planDeductions([{ raw_material_id: "kopi", needed: 0.5 }], stock)).toEqual([
      { inventory_id: "inv-b1", raw_material_id: "kopi", warehouse_id: "w1", take: 0.5, before: 1.2, after: 0.7 },
    ]);
  });
});
