import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const { toLowStockItem } = await import("./low-stock");

describe("toLowStockItem", () => {
  it("saran order sampai maksimum dan estimasi biaya", () => {
    const item = toLowStockItem({
      id: "inv-1",
      raw_material_id: "rm-1",
      material_kode: "BB-1",
      material_nama: "Susu",
      material_kategori: "dairy",
      qty_available: 2,
      qty_on_order: 3,
      qty_minimum: 10,
      qty_maximum: 20,
      unit_cost: 1500,
      satuan: "liter",
      stock_status: "low_stock",
      warehouse_nama: "Gudang Utama",
      supplier_id: null,
      supplier_name: null,
      last_purchase_date: null,
    });
    expect(item).toMatchObject({
      kategori: "dairy",
      suggested_order_qty: 15,
      suggestion_basis: "maximum",
      estimated_cost: 22500,
      supplier_name: undefined,
      last_purchase_date: undefined,
    });
  });
});
