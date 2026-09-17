import { describe, expect, it } from "vitest";
import { buildFlashReportMessage, wibDayRange, type FlashReportData } from "./flash-report";

const contoh: FlashReportData = {
  operationHour: "11.00–20.00 WIB",
  revenue: 8_892_000,
  nettSales: 3_806_000,
  discount: 5_086_000,
  citizenCardTx: 0,
  fullDiscountTx: 13,
  kolCompIdr: 350_000,
  kolCompTx: 3,
  ownerCompIdr: 0,
  ownerCompTx: 0,
  focCompIdr: 120_000,
  focCompTx: 2,
  guestCount: 70,
  byStall: [
    { name: "Es Cekek Corner", revenue: 2_570_500, pcs: 103 },
    { name: "Sushi Corner", revenue: 2_130_000, pcs: 36 },
    { name: "Kobo Corner", revenue: 0, pcs: 0 },
  ],
  byCategory: [
    { name: "Makanan", revenue: 7_527_000, pcs: 200 },
    { name: "Minuman", revenue: 2_570_500, pcs: 103 },
  ],
  topProducts: [
    { name: "Yuzu Milk", pcs: 24 },
    { name: "Oolong Peach", pcs: 23 },
  ],
};

describe("buildFlashReportMessage", () => {
  it("meniru struktur laporan manual Operations", () => {
    const msg = buildFlashReportMessage(contoh, "2026-08-22");
    expect(msg).toContain("*Daily Flash Report*");
    expect(msg).toContain("BCD COFFEE");
    expect(msg).toContain("Sabtu, 22 Agustus 2026");
    expect(msg).toContain("Revenue : Rp 8.892.000");
    expect(msg).toContain("Nett Sales : Rp 3.806.000");
    expect(msg).toContain("Discount : Rp 5.086.000");
    expect(msg).toContain("SULU Citizen : 0 Card");
    expect(msg).toContain("Disc 100% : 13 Transaksi");
    // EPIC-043: komplimen dipecah per jenis; baris muncul hanya bila ada
    expect(msg).toContain("KOL Comp : Rp 350.000 (3 Trx)");
    expect(msg).toContain("Komplimen FOC : Rp 120.000 (2 Trx)");
    expect(msg).not.toContain("Owner Comp");
    expect(msg).toContain("No of Guest : 70 Pax");
    // 3.806.000 / 70 = 54.371 — cocok dengan laporan manual
    expect(msg).toContain("Average/Pax : Rp 54.371");
    expect(msg).toContain("Es Cekek Corner : Rp 2.570.500 (103 Pcs)");
    // Stall sepi tetap tampil, tanpa "(0 Pcs)" — seperti laporan manual
    expect(msg).toContain("Kobo Corner : Rp 0");
    expect(msg).toContain("Makanan : Rp 7.527.000 (200 Pcs)");
    expect(msg).toContain("1. Yuzu Milk : 24 pcs");
  });

  it("tanpa data tetap valid (hari libur)", () => {
    const msg = buildFlashReportMessage(
      {
        ...contoh,
        operationHour: null,
        revenue: 0,
        nettSales: 0,
        discount: 0,
        citizenCardTx: 0,
        fullDiscountTx: 0,
        kolCompIdr: 0,
        kolCompTx: 0,
        ownerCompIdr: 0,
        ownerCompTx: 0,
        focCompIdr: 0,
        focCompTx: 0,
        guestCount: 0,
        byStall: [],
        byCategory: [],
        topProducts: [],
      },
      "2026-08-22"
    );
    expect(msg).toContain("Average/Pax : Rp 0");
    expect(msg).not.toContain("Jam operasional");
    expect(msg).toContain("—");
  });
});

describe("wibDayRange", () => {
  it("membatasi satu hari penuh WIB", () => {
    const { start, end } = wibDayRange("2026-08-22");
    expect(start).toBe("2026-08-21T17:00:00.000Z");
    expect(end).toBe("2026-08-22T17:00:00.000Z");
  });
});
