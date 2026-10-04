import { describe, expect, it } from "vitest";
import { buildInventoryValuation } from "./report-inventory-valuation";
import { buildPoDetail, buildPoSummary, mapPoLineItem, poDetailCsvRows, poSummaryCsv } from "./report-po";
import { buildProductionInHouseReport, productionInHouseCsvRows } from "./report-production-in-house";
import { quotedCsv } from "./report-query";
import { buildStockCardSummary, normalizeMovement } from "./report-stock-card";

describe("PO reports", () => {
  const pos = [
    { id: "po-1", nomor_po: "PO-1", nama_supplier: "Alpha", supplier_kode: "A", status: "SENT", tanggal_po: "2026-09-01", total: "1500000.50", item_count: 2, created_by_name: "Budi" },
    { id: "po-2", po_number: "PO-2", vendor_name: "Beta", status: "sent", total_amount: 500000 },
    { id: "po-3", nomor_po: "PO-3", status: null, payable_amount: "250000" },
  ];

  it("summarizes POs with legacy column fallbacks", () => {
    const report = buildPoSummary(pos);
    expect(report.summary[0]).toEqual({
      po_number: "PO-1",
      vendor: "Alpha",
      vendor_code: "A",
      status: "sent",
      tanggal_po: "2026-09-01",
      tanggal_diterima: null,
      total_amount: 1500000.5,
      total_amount_formatted: "1.500.001",
      mata_uang: "IDR",
      item_count: 2,
      created_by: "Budi",
    });
    expect(report.summary[1]).toMatchObject({ po_number: "PO-2", vendor: "Beta", created_by: "-" });
    expect(report.by_status).toEqual([
      { status: "sent", count: 2, total: 2000000.5, total_formatted: "2.000.001" },
      { status: "unknown", count: 1, total: 250000, total_formatted: "250.000" },
    ]);
    expect(report.grand_total).toBe(2250000.5);
    expect(poSummaryCsv(report.summary).split("\n")[1]).toBe(
      'PO-1,"Alpha",A,sent,2026-09-01,,1500000.5,IDR,2,"Budi"'
    );
  });

  it("maps PO line items from joined rows", () => {
    expect(
      mapPoLineItem({
        purchase_order_id: "po-1",
        raw_material_id: "rm-1",
        qty_ordered: "3",
        harga_satuan: "1000",
        raw_material: { kode: "GULA", nama: "Gula" },
        satuan: { kode: "KG", nama: null },
      })
    ).toEqual({
      id: "rm-1",
      nama_bahan: "Gula",
      kode_bahan: "GULA",
      qty_order: 3,
      qty_received: 0,
      harga_satuan: 1000,
      satuan: "KG",
      subtotal: 3000,
    });
  });

  it("builds detail rows and a csv with PO columns on the first item only", () => {
    const report = buildPoDetail(pos.slice(0, 2), [
      { id: "i1", purchase_order_id: "po-1", qty_ordered: 1, harga_satuan: 10, nama: "A" },
      { id: "i2", purchase_order_id: "po-1", qty_ordered: 2, harga_satuan: 10, nama: "B" },
    ]);
    expect(report.summary[0].item_count).toBe(2);
    expect(report.summary[1].items).toEqual([]);
    expect(report.grand_total_formatted).toBe("2.000.001");

    const { header, rows } = poDetailCsvRows(report.summary);
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(0, 6)).toEqual(["", "", "", "", "", "B"]);
    expect(rows[2].slice(5, 7)).toEqual(["-", "-"]);
    expect(quotedCsv(header.slice(0, 2), [['a"b', "c"]])).toBe('"No PO","Tanggal"\n"a""b","c"');
  });
});

describe("buildProductionInHouseReport", () => {
  it("values HPP by actual qty or by cost components and groups by status", () => {
    const report = buildProductionInHouseReport(
      [
        { id: "o1", nomor_produksi: "P1", product_id: "p1", status: "completed", planned_qty: 10, actual_qty: 8, hpp_per_unit: 1000 },
        { id: "o2", nomor_produksi: "P2", product_id: "p2", status: "DRAFT", planned_qty: 5, planned_material_cost: 300, overhead_cost: 50 },
        { id: "o3", nomor_produksi: "P3", item_nama: "Item", status: "DRAFT", planned_qty: 1 },
      ],
      new Map([["p1", { warehouse_id: "w1", warehouse_name: "Stall 1", warehouse_code: "S1" }]])
    );
    expect(report.orders[0]).toMatchObject({
      status: "COMPLETED",
      total_hpp_value: 8000,
      total_hpp_value_formatted: "8.000",
      warehouse_name: "Stall 1",
    });
    expect(report.orders[0]).not.toHaveProperty("hppValue");
    expect(report.orders[1]).toMatchObject({ total_hpp_value: 350, warehouse_id: null });
    expect(report.orders[2]).toMatchObject({ product_nama: "Item", product_kode: "" });
    expect(report.by_status.map((row) => [row.status, row.count])).toEqual([
      ["DRAFT", 2],
      ["COMPLETED", 1],
    ]);
    expect(report.summary).toEqual({
      total_orders: 3,
      total_planned_qty: 16,
      total_actual_qty: 8,
      total_hpp_value: 8350,
      completed_orders: 1,
    });
    expect(productionInHouseCsvRows(report.orders).rows[0][9]).toBe("Stall 1");
  });
});

describe("buildInventoryValuation", () => {
  it("values stock and labels categories", () => {
    const result = buildInventoryValuation([
      { kategori: "KEMASAN", qty_onhand: "10", unit_cost: "500", stok_minimum: 2 },
      { kategori: "KEMASAN", qty_onhand: 1, avg_cost: 1000, satuan_besar_nama: "pak", lokasi_rak: "R1" },
      { kategori: "CUSTOM", qty_onhand: null },
    ]);
    expect(result.data[0]).toMatchObject({ avg_cost: 500, unit_cost: 500, total_value: 5000, min_stock: 2, max_stock: null, lokasi_rak: "-" });
    expect(result.data[1]).toMatchObject({ satuan: "pak", lokasi_rak: "R1" });
    expect(result.summary).toEqual({
      total_value: 6000,
      total_items: 3,
      by_category: [
        { kategori: "Kemasan", total_value: 6000, item_count: 2 },
        { kategori: "CUSTOM", total_value: 0, item_count: 1 },
      ],
    });
  });
});

describe("stock card", () => {
  const movement = (tipe: "in" | "out" | "adjustment", jumlah: number, before: number, after: number) =>
    normalizeMovement({ id: `${tipe}-${after}`, tipe, jumlah, qty_before: before, qty_after: after }, "rm-1", undefined, new Map([["rm-1", 100]]));

  it("falls back to the item cost and keeps placeholder labels", () => {
    const row = movement("out", -2, 10, 8);
    expect(row).toMatchObject({ unit_cost: 100, total_cost: 200, item_nama: "rm-1", item_kategori: "-", reference_number: "-" });
  });

  it("sums movement types and tracks the closing balance", () => {
    const summary = buildStockCardSummary(
      [movement("in", 10, 0, 10), movement("out", 3, 10, 7), movement("adjustment", 0, 7, 5)],
      0,
      99
    );
    expect(summary).toMatchObject({
      opening_balance: 0,
      closing_balance: 5,
      total_in: 10,
      total_out: 3,
      total_adjustment_out: 2,
      movement_count: 3,
    });
    expect(buildStockCardSummary([], 4, 99).closing_balance).toBe(99);
  });
});
