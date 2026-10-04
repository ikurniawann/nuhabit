import { describe, expect, it } from "vitest";
import { mapQcDetail, mapQcListRow, mapQcStatus, toQcInspectionItems, type QcInspectionRow } from "./qc-inspections";

const row: QcInspectionRow = {
  id: "qc-1",
  grn_id: "grn-1",
  status: "partial",
  catatan: "cek",
  created_at: "2026-10-04T01:00:00Z",
  inspected_at: null,
  grn: { nomor_grn: "GRN-1" },
  items: [
    { raw_material_id: "rm-1", qty_inspected: "4", qty_accepted: "3", qty_rejected: "1", raw_material: { nama: "Gula" } },
    { raw_material_id: "rm-2", qty_inspected: 2, qty_accepted: 2, qty_rejected: null },
  ],
};

describe("mapQcStatus", () => {
  it("maps inspection status to the legacy enum", () => {
    expect(mapQcStatus("approved")).toBe("APPROVED");
    expect(mapQcStatus("rejected")).toBe("REJECTED");
    expect(mapQcStatus(null)).toBe("PARTIAL");
  });
});

describe("mapQcListRow", () => {
  it("sums item quantities and keeps legacy field names", () => {
    expect(mapQcListRow(row)).toMatchObject({
      qc_number: "qc-1",
      goods_receipt_id: "grn-1",
      grn_number: "GRN-1",
      bahan_baku_id: "rm-1",
      jumlah_diperiksa: 6,
      jumlah_diterima: 5,
      jumlah_ditolak: 1,
      hasil: "partial",
      tanggal_inspeksi: "2026-10-04T01:00:00Z",
      status: "PARTIAL",
      rekomendasi: "REWORK",
    });
    expect(mapQcListRow(row).items[0]).toEqual({
      bahan_baku_id: "rm-1",
      raw_material_id: "rm-1",
      jumlah_diperiksa: "4",
      jumlah_diterima: "3",
      jumlah_ditolak: "1",
      raw_material: { nama: "Gula" },
    });
  });
});

describe("mapQcDetail", () => {
  it("keeps the raw row and overrides status with the legacy enum", () => {
    const detail = mapQcDetail({ ...row, status: "approved" });
    expect(detail).toMatchObject({
      id: "qc-1",
      catatan: "cek",
      bahan_baku: { nama: "Gula" },
      status: "APPROVED",
      rekomendasi: "ACCEPT",
    });
  });
});

describe("toQcInspectionItems", () => {
  it("accepts legacy field names and derives inspected qty", () => {
    expect(
      toQcInspectionItems([
        { grn_item_id: "gi-1", bahan_baku_id: "rm-1", jumlah_diterima: 3, jumlah_ditolak: 1, alasan: "pecah" },
      ])
    ).toEqual([
      { grn_item_id: "gi-1", raw_material_id: "rm-1", qty_inspected: 4, qty_accepted: 3, qty_rejected: 1, catatan: "pecah" },
    ]);
  });

  it("requires a raw material per item", () => {
    expect(() => toQcInspectionItems([{ grn_item_id: "gi-1" }])).toThrow(
      "raw_material_id atau bahan_baku_id wajib diisi per item"
    );
  });
});
