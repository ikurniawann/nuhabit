import { describe, expect, it } from "vitest";
import { breakdownBars, dateStamp, formatPct, toCsv } from "./report-ui-shared";
import { normalizePoDetailRows, poDetailCsvRows, poStatusBreakdown, receivedSummary } from "./report-ui-po";
import {
  filterInventory,
  inventoryCategories,
  inventoryCategoryBreakdown,
  inventoryCsvRows,
  stockStatus,
  summarizeInventory,
  toInventoryRow,
} from "./report-ui-inventory";
import { summarizeSupplierPerformance, supplierCsvRows, topSpendSuppliers } from "./report-ui-supplier";
import { movementDelta, stockCardFiltersFromUrl, stockCardTotals } from "./report-ui-stock-card";
import type { StockMovement } from "./report-ui-types";

describe("report shared helpers", () => {
  it("quotes every CSV cell and escapes quotes", () => {
    expect(toCsv(["A", "B"], [['x"y', 12.5]])).toBe('"A","B"\n"x""y","12.5"');
  });

  it("stamps files with the UTC date", () => {
    expect(dateStamp(new Date("2026-10-04T20:00:00Z"))).toBe("2026-10-04");
  });

  it("formats percentages with one decimal", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(null)).toBe("-");
    expect(formatPct(Number.NaN)).toBe("-");
  });

  it("computes share of total and width relative to the largest row", () => {
    const bars = breakdownBars(
      [
        { key: "a", label: "A", caption: "", value: 300 },
        { key: "b", label: "B", caption: "", value: 100 },
      ],
      400
    );
    expect(bars.map((bar) => bar.share)).toEqual([75, 25]);
    expect(bars[0].width).toBe(100);
    expect(bars[1].width).toBeCloseTo(33.33, 2);
    expect(breakdownBars([{ key: "z", label: "Z", caption: "", value: 0 }], 0)[0]).toMatchObject({ share: 0, width: 0 });
  });
});

describe("PO report helpers", () => {
  const raw = [
    {
      id: "po-1",
      po_number: "PO-001",
      tanggal_po: "2026-10-01",
      vendor: "PT Gula",
      status: "APPROVED",
      total_amount: "150000",
      items: [
        { id: "i1", nama_bahan: "Gula", kode_bahan: "G1", qty_order: 10, qty_received: 4, harga_satuan: 10000, subtotal: 100000 },
        { kode: "T1", nama: "Teh", quantity: "5", unit_price: "10000" },
      ],
    },
    { po_number: "PO-002", vendor: "CV Kopi", status: "received", total_amount: 50000 },
  ];

  it("normalises legacy and new column names", () => {
    const [first, second] = normalizePoDetailRows(raw);
    expect(first).toMatchObject({ id: "po-1", no_po: "PO-001", status: "approved", total: 150000, item_count: 2 });
    expect(first.items[1]).toMatchObject({ id: "PO-001-undefined", nama_bahan: "Teh", kode_bahan: "T1", qty_order: 5, subtotal: 0 });
    expect(second).toMatchObject({ id: "PO-002", item_count: 0, items: [] });
  });

  it("groups by status with the largest value first", () => {
    const breakdown = poStatusBreakdown(normalizePoDetailRows(raw));
    expect(breakdown.map((row) => [row.key, row.label, row.caption, row.value])).toEqual([
      ["approved", "Approved", "1 PO", 150000],
      ["received", "Fully Received", "1 PO", 50000],
    ]);
  });

  it("sums fully and partially received statuses", () => {
    expect(
      receivedSummary([
        { status: "received", count: 2, total: 100, total_formatted: "" },
        { status: "partial", count: 1, total: 50, total_formatted: "" },
        { status: "approved", count: 9, total: 900, total_formatted: "" },
      ])
    ).toEqual({ count: 3, total: 150 });
  });

  it("writes one CSV row per item with raw numbers", () => {
    const rows = poDetailCsvRows(normalizePoDetailRows(raw));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["PO-001", "1 Okt 2026", "PT Gula", "approved", "Gula", "G1", "10", "4", "10000", "100000", "150000"]);
    expect(rows[1].slice(0, 4)).toEqual(["", "", "", ""]);
    expect(rows[2]).toEqual(["PO-002", "-", "CV Kopi", "received", "-", "-", "", "", "", "", "50000"]);
  });
});

describe("inventory valuation helpers", () => {
  const rows = [
    { id: "a", kode: "A1", nama: "Gula", kategori: "BAHAN_PANGAN", qty_onhand: 2, min_stock: 10, avg_cost: 1000 },
    { raw_material_id: "b", kode: "B1", nama: "Box", kategori: "KEMASAN", qty_onhand: 8, stok_minimum: 10, unit_cost: 500 },
    { id: "c", kode: "C1", nama: "Solar", qty_onhand: 0 },
  ].map(toInventoryRow);

  it("classifies stock status against the minimum", () => {
    expect(stockStatus(0, 10)).toBe("empty");
    expect(stockStatus(2, 10)).toBe("critical");
    expect(stockStatus(8, 10)).toBe("warning");
    expect(stockStatus(8, 0)).toBe("normal");
  });

  it("maps API rows with category labels and fallbacks", () => {
    expect(rows[1]).toMatchObject({ id: "b", kategori: "Kemasan", minimum_stock: 10, avg_unit_cost: 500, stock_status: "warning" });
    expect(rows[2]).toMatchObject({ kategori: "Lainnya", stock_status: "empty" });
  });

  it("filters, summarises and breaks down by category", () => {
    expect(filterInventory(rows, " box ", "all").map((row) => row.id)).toEqual(["b"]);
    expect(filterInventory(rows, "", "Bahan Pangan").map((row) => row.id)).toEqual(["a"]);
    expect(inventoryCategories(rows)).toEqual(["Bahan Pangan", "Kemasan", "Lainnya"]);
    expect(summarizeInventory(rows)).toEqual({ totalValue: 6000, totalQty: 10, warningCount: 1, criticalCount: 2 });
    expect(inventoryCategoryBreakdown(rows)[0]).toEqual({ key: "Kemasan", label: "Kemasan", caption: "1 item", value: 4000 });
    expect(inventoryCsvRows(rows)[0]).toEqual(["A1", "Gula", "Bahan Pangan", "", "2", "", "10", "", "1000", "2000", "Critical"]);
  });
});

describe("supplier performance helpers", () => {
  const rows = [
    { id: "s1", total_value: 100, total_po: 2, on_time_rate: 80, reject_rate: 2, rating: 4.25 },
    { id: "s2", total_value: 300, total_po: 1, on_time_rate: null, reject_rate: 8 },
  ];

  it("averages on-time only over suppliers with data", () => {
    expect(summarizeSupplierPerformance(rows)).toEqual({ totalValue: 400, totalPo: 3, avgOnTime: 80, avgReject: 5 });
    expect(summarizeSupplierPerformance([]).avgOnTime).toBeNull();
  });

  it("ranks top spend and exports fixed decimals", () => {
    expect(topSpendSuppliers(rows, 1).map((row) => row.id)).toEqual(["s2"]);
    expect(supplierCsvRows(rows)[0]).toEqual(["", "", "", "2", "0", "0", "80.0", "2.0", "", "100", "4.3", ""]);
  });
});

describe("stock card helpers", () => {
  const movement = (overrides: Partial<StockMovement>) => ({ qty_before: 10, qty_after: 10, jumlah: 3, tipe: "out", ...overrides }) as StockMovement;

  it("derives the signed delta", () => {
    expect(movementDelta(movement({ qty_after: 13 }))).toBe(3);
    expect(movementDelta(movement({}))).toBe(-3);
    expect(movementDelta(movement({ tipe: "in" }))).toBe(3);
  });

  it("sums inbound and outbound totals", () => {
    expect(
      stockCardTotals({
        opening_balance: 0,
        closing_balance: 0,
        total_in: 5,
        total_out: 2,
        total_adjustment_in: 1,
        total_adjustment_out: 1,
        total_return: 1,
        total_transfer: 0,
        total_value: 0,
        movement_count: 0,
      })
    ).toEqual({ totalIn: 7, totalOut: 3 });
    expect(stockCardTotals()).toEqual({ totalIn: 0, totalOut: 0 });
  });

  it("reads deep-link filters from the URL", () => {
    expect(stockCardFiltersFromUrl(new URLSearchParams("material_id=m1&warehouse_id=w1"))).toEqual({
      itemType: "raw_material",
      selectedItem: "m1",
      warehouseId: "w1",
    });
    expect(stockCardFiltersFromUrl(new URLSearchParams("product_id=p1"))).toMatchObject({ itemType: "product", selectedItem: "p1" });
    expect(stockCardFiltersFromUrl(new URLSearchParams("item_type=product"))).toEqual({
      itemType: "product",
      selectedItem: "all",
      warehouseId: "all",
    });
  });
});
