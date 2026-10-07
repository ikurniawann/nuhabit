import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn() }));

const { computeStockStatus, filterStockRows, paginateRows } = await import("./warehouse-stock");
type Row = Parameters<typeof filterStockRows>[0][number];

function row(kode: string, nama: string, qty: number, min = 10): Row {
  return {
    raw_material_id: kode,
    inventory_id: null,
    material_kode: kode,
    material_nama: nama,
    material_kategori: null,
    satuan: null,
    satuan_besar_nama: null,
    satuan_kecil_nama: null,
    konversi_factor: null,
    harga_beli: null,
    qty_onhand: qty,
    min_stock: min,
    max_stock: null,
    unit_cost: 0,
    warehouse_id: null,
    warehouse_nama: null,
  };
}

const rows = [row("BB-1", "Gula Aren", 0), row("BB-2", "Susu", 5), row("BB-3", "Kopi", 50)];

describe("computeStockStatus", () => {
  it("HABIS ≤ 0, MENIPIS ≤ minimum, selain itu AMAN", () => {
    expect([computeStockStatus(0, 10), computeStockStatus(10, 10), computeStockStatus(11, 10)]).toEqual([
      "HABIS",
      "MENIPIS",
      "AMAN",
    ]);
  });
});

describe("filterStockRows", () => {
  it("cari kode atau nama tanpa peka huruf", () => {
    expect(filterStockRows(rows, " kopi ").map((r) => r.material_kode)).toEqual(["BB-3"]);
    expect(filterStockRows(rows, "bb-2").map((r) => r.material_kode)).toEqual(["BB-2"]);
  });

  it("filter status stok", () => {
    expect(filterStockRows(rows, undefined, "out_of_stock").map((r) => r.material_kode)).toEqual(["BB-1"]);
    expect(filterStockRows(rows, undefined, "low_stock").map((r) => r.material_kode)).toEqual(["BB-2"]);
    expect(filterStockRows(rows, undefined, "normal").map((r) => r.material_kode)).toEqual(["BB-3"]);
    expect(filterStockRows(rows, undefined, "lainnya")).toHaveLength(3);
  });
});

describe("paginateRows", () => {
  it("potong per halaman dan laporkan total", () => {
    expect(paginateRows([1, 2, 3, 4, 5], 2, 2)).toEqual({ total: 5, data: [3, 4] });
  });
});
