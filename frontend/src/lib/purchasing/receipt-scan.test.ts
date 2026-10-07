import { describe, expect, it } from "vitest";
import { findDate, findNumber, findTotal, parseAmount, parseReceiptText } from "./receipt-scan";

describe("parseAmount", () => {
  it("membaca format rupiah titik-ribuan", () => {
    expect(parseAmount("Rp 1.234.567")).toBe(1_234_567);
    expect(parseAmount("1.500")).toBe(1_500);
  });

  it("membaca desimal di belakang (koma atau titik)", () => {
    expect(parseAmount("1.234.567,50")).toBe(1_234_568);
    expect(parseAmount("1,234,567.00")).toBe(1_234_567);
  });

  it("angka polos dan nol/negatif", () => {
    expect(parseAmount("250000")).toBe(250_000);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("findDate", () => {
  it("dd/mm/yyyy dan dd-mm-yy", () => {
    expect(findDate("Tanggal: 12/07/2026")).toBe("2026-07-12");
    expect(findDate("tgl 5-1-26")).toBe("2026-01-05");
  });

  it("nama bulan Indonesia", () => {
    expect(findDate("Bandung, 12 Juli 2026")).toBe("2026-07-12");
    expect(findDate("3 Agustus 2026")).toBe("2026-08-03");
  });

  it("format mm/dd tertukar tetap menghasilkan tanggal valid", () => {
    // 07/25 → 25 tidak valid sebagai bulan, jatuh ke interpretasi kedua.
    expect(findDate("07/25/2026")).toBe("2026-07-25");
  });

  it("teks tanpa tanggal", () => {
    expect(findDate("tidak ada apa-apa")).toBeNull();
  });
});

describe("findNumber", () => {
  it("berbagai label nomor", () => {
    expect(findNumber("No. Nota: 0123/ABC/26")).toBe("0123/ABC/26");
    expect(findNumber("Invoice INV-2026-0712 tanggal ...")).toBe("INV-2026-0712");
    expect(findNumber("Faktur : FKT.001.26")).toBe("FKT.001.26");
  });

  it("label yang diikuti tanggal murni tidak dianggap nomor", () => {
    expect(findNumber("No 12/07/2026")).toBeNull();
  });
});

describe("findTotal", () => {
  it("mengambil angka paling kanan pada baris total", () => {
    expect(findTotal("Subtotal 100.000\nDiskon 10.000\nTOTAL Rp 90.000")).toBe(90_000);
  });

  it("grand total menang atas subtotal (nilai terbesar antar baris kandidat)", () => {
    expect(findTotal("Total 100.000\nPPN 11.000\nGrand Total 111.000")).toBe(111_000);
  });

  it("tanpa kata kunci total → null (jangan menebak angka sembarang)", () => {
    expect(findTotal("Beras 5kg 70.000\nMinyak 2L 38.000")).toBeNull();
  });
});

describe("parseReceiptText — nota utuh", () => {
  it("nota toko khas OCR", () => {
    const text = [
      "TOKO SUMBER REZEKI",
      "Jl. Merdeka No. 12 Bandung",
      "No Nota: SR-0451",
      "Tanggal: 24/07/2026",
      "Beras 5kg        70.000",
      "Minyak 2L        38.000",
      "Gula 1kg         15.000",
      "TOTAL        Rp 123.000",
      "Tunai            150.000",
      "Kembali           27.000",
    ].join("\n");
    expect(parseReceiptText(text)).toEqual({
      nomor: "SR-0451",
      tanggal: "2026-07-24",
      total: 123_000,
    });
  });

  it("teks kosong", () => {
    expect(parseReceiptText("  ")).toEqual({ nomor: null, tanggal: null, total: null });
  });

  it("sebagian terbaca tetap dikembalikan (bukan semua-atau-tidak)", () => {
    const hasil = parseReceiptText("nota belanja bulanan\ntotal 250.000");
    expect(hasil.total).toBe(250_000);
    expect(hasil.nomor).toBeNull();
  });
});
