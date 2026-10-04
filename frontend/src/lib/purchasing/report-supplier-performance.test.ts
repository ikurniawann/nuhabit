import { describe, expect, it } from "vitest";
import {
  daysBetween,
  qualityFromReject,
  rankSupplierPerformance,
  supplierPerformanceCsv,
  supplierPerformanceSummary,
} from "./report-supplier-performance";

const suppliers = [
  { id: "s-a", kode: "SUP-A", nama_supplier: "Alpha", pic_name: "Ani", telepon: null, pic_phone: "0812", email: "a@x.id" },
  { id: "s-b", kode: "SUP-B", nama_supplier: "Beta" },
  { id: "s-c", kode: "SUP-C", nama_supplier: "Tanpa PO" },
];

const pos = [
  { id: "po-1", supplier_id: "s-a", status: "received", total: "1000000", tanggal_po: "2026-09-01", tanggal_dibutuhkan: "2026-09-05" },
  { id: "po-2", supplier_id: "s-a", status: "sent", total: 500000, tanggal_po: "2026-09-02", tanggal_kirim_estimasi: "2026-09-04" },
  { id: "po-3", supplier_id: "s-b", status: "partial", total: 3000000, tanggal_po: "2026-09-01" },
  { id: "po-4", supplier_id: "s-b", status: "cancelled", total: 9000000, tanggal_po: "2026-09-01" },
];

describe("helpers", () => {
  it("daysBetween ignores missing or invalid dates and never goes negative", () => {
    expect(daysBetween("2026-09-01", "2026-09-04")).toBe(3);
    expect(daysBetween("2026-09-04", "2026-09-01")).toBe(0);
    expect(daysBetween(null, "2026-09-01")).toBeNull();
    expect(daysBetween("nope", "2026-09-01")).toBeNull();
  });

  it("qualityFromReject buckets the reject rate", () => {
    expect([0, 4.9, 9.9, 10].map(qualityFromReject)).toEqual([100, 80, 60, 40]);
  });
});

describe("rankSupplierPerformance", () => {
  const ranked = rankSupplierPerformance({
    suppliers,
    pos,
    deliveries: [
      // Tepat waktu terhadap estimasi delivery.
      { purchase_order_id: "po-1", tanggal_aktual_tiba: "2026-09-03", tanggal_estimasi_tiba: "2026-09-03" },
      // Tanpa estimasi delivery: dibandingkan dengan tanggal_kirim_estimasi PO -> terlambat.
      { purchase_order_id: "po-2", tanggal_aktual_tiba: "2026-09-06" },
    ],
    grns: [
      { id: "grn-1", purchase_order_id: "po-1", tanggal_penerimaan: "2026-09-03", total_item_diterima: 10, total_item_ditolak: 0 },
      // PO tanpa delivery: GRN dipakai untuk lead time; tanpa deadline tidak dihitung tepat waktu.
      { id: "grn-3", purchase_order_id: "po-3", tanggal_penerimaan: "2026-09-08", total_item_diterima: 90, total_item_ditolak: 10 },
    ],
    inspections: [{ grn_id: "grn-1", items: [{ qty_inspected: 20, qty_rejected: "1" }] }],
  });

  it("drops suppliers without active POs and ranks by spend", () => {
    expect(ranked.map((row) => [row.supplier_id, row.rank])).toEqual([
      ["s-b", 1],
      ["s-a", 2],
    ]);
  });

  it("excludes cancelled POs from counts and value", () => {
    const beta = ranked[0];
    expect(beta).toMatchObject({ total_po: 1, completed_po: 1, total_value: 3000000, avg_po_value: 3000000 });
    expect(beta.on_time_rate).toBeNull();
    expect(beta.avg_lead_time_days).toBe(7);
    expect(beta.reject_rate).toBe(10);
    expect(beta.quality_score).toBe(40);
    // (50 * 0.5 + 40 * 0.5) / 20 = 2.25 -> 2.3
    expect(beta.rating).toBe(2.3);
  });

  it("combines delivery timing with QC results", () => {
    const alpha = ranked[1];
    expect(alpha).toMatchObject({
      total_po: 2,
      completed_po: 1,
      on_time_count: 1,
      late_count: 1,
      on_time_rate: 50,
      reject_rate: 5,
      quality_score: 60,
      telepon: "0812",
      total_spent_formatted: "1.500.000",
    });
    expect(alpha.avg_lead_time_days).toBe(3);
  });

  it("builds the summary and csv", () => {
    const report = supplierPerformanceSummary(ranked, { export: "json", date_from: "2026-09-01" });
    expect(report.summary).toMatchObject({
      total_suppliers: 2,
      top_supplier: "Beta",
      total_spend_all_suppliers: 4500000,
      period: { from: "2026-09-01", to: undefined },
    });
    const csv = supplierPerformanceCsv(ranked).split("\n");
    expect(csv).toHaveLength(3);
    expect(csv[2]).toBe('2,SUP-A,"Alpha","Ani","0812","a@x.id",2,1,1,50,5,3,1500000,2.8,60');
  });
});
