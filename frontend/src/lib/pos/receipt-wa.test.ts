import { describe, expect, it } from "vitest";

import {
  buildMemberBillReminderMessage,
  buildOrderReceiptMessage,
  buildShiftReportMessage,
  buildTopupReceiptMessage,
  MEMBER_BILL_WA_MAX_ORDERS,
  normalizeWaPhone,
} from "./receipt-wa";

/**
 * Tes ditulis lebih dulu (fitur WA struk & laporan tutup kasir).
 *
 * Pesan-pesan ini dikirim ke PELANGGAN dan OWNER — sekali salah format
 * (angka rupiah tanpa pemisah, nomor tak ternormalisasi sampai gagal kirim)
 * langsung terlihat oleh orang di luar tim. Karena itu builder dibuat murni
 * dan diuji, bukan digabung ke route handler.
 */

describe("normalizeWaPhone", () => {
  it("mengubah 08xx menjadi 628xx", () => {
    expect(normalizeWaPhone("081234567890")).toBe("6281234567890");
  });

  it("menerima +62 dan spasi/strip dari input kasir", () => {
    expect(normalizeWaPhone("+62 812-3456-7890")).toBe("6281234567890");
  });

  it("input terlalu pendek atau kosong → null, bukan mengirim ke nomor rusak", () => {
    expect(normalizeWaPhone("0812")).toBeNull();
    expect(normalizeWaPhone("")).toBeNull();
    expect(normalizeWaPhone(null)).toBeNull();
  });
});

describe("buildOrderReceiptMessage", () => {
  const dasar = {
    outletName: "Sulu",
    orderNumber: "ORD-001",
    orderedAt: "2026-08-14T12:30:00+07:00",
    items: [
      { name: "Kopi Susu", quantity: 2, total: 36_000 },
      { name: "Croissant", quantity: 1, total: 28_000 },
    ],
    total: 64_000,
    paymentMethod: "cash",
    change: 6_000,
  };

  it("memuat nomor order, tiap item, total, dan kembalian", () => {
    const pesan = buildOrderReceiptMessage(dasar);
    expect(pesan).toContain("ORD-001");
    expect(pesan).toContain("2x Kopi Susu");
    expect(pesan).toContain("Rp 36.000");
    expect(pesan).toContain("Rp 64.000");
    expect(pesan).toContain("Kembalian");
  });

  it("tanpa kembalian (non-tunai) baris kembalian tidak muncul", () => {
    const pesan = buildOrderReceiptMessage({ ...dasar, paymentMethod: "qris", change: 0 });
    expect(pesan).not.toContain("Kembalian");
    expect(pesan.toUpperCase()).toContain("QRIS");
  });

  it("transaksi gabungan: item SEMUA stall ikut, dikelompokkan per stall", () => {
    const pesan = buildOrderReceiptMessage({
      ...dasar,
      orderNumber: "CHK-20260825-0012",
      items: [
        { name: "Cofe Peach", quantity: 1, total: 36_000, stallName: "Yakitori Stall" },
        { name: "Matchaaa Pistachio", quantity: 1, total: 36_000, stallName: "Rice bowl Stall" },
        { name: "Gyoza", quantity: 2, total: 40_000, stallName: "Dumpling Stall" },
      ],
      total: 112_000,
    });
    // tiap stall punya judulnya sendiri
    expect(pesan).toContain("_Yakitori Stall_");
    expect(pesan).toContain("_Rice bowl Stall_");
    expect(pesan).toContain("_Dumpling Stall_");
    // dan TIDAK ada produk yang hilang
    expect(pesan).toContain("1x Cofe Peach");
    expect(pesan).toContain("1x Matchaaa Pistachio");
    expect(pesan).toContain("2x Gyoza");
    expect(pesan).toContain("Rp 112.000");
  });

  it("transaksi satu stall tetap tampil datar tanpa judul stall", () => {
    const pesan = buildOrderReceiptMessage({
      ...dasar,
      items: [
        { name: "Kopi Susu", quantity: 2, total: 36_000, stallName: "Yakitori Stall" },
        { name: "Croissant", quantity: 1, total: 28_000, stallName: "Yakitori Stall" },
      ],
    });
    expect(pesan).not.toContain("_Yakitori Stall_");
    expect(pesan).toContain("2x Kopi Susu");
    expect(pesan).toContain("1x Croissant");
  });

  it("item tanpa nama stall tetap ikut tercetak di transaksi gabungan", () => {
    const pesan = buildOrderReceiptMessage({
      ...dasar,
      items: [
        { name: "Cofe Peach", quantity: 1, total: 36_000, stallName: "Yakitori Stall" },
        { name: "Gyoza", quantity: 1, total: 20_000, stallName: "Dumpling Stall" },
        { name: "Item Lama", quantity: 1, total: 10_000 },
      ],
    });
    expect(pesan).toContain("1x Item Lama");
  });

  it("diskon tampil hanya bila ada", () => {
    expect(buildOrderReceiptMessage(dasar)).not.toContain("Diskon");
    expect(
      buildOrderReceiptMessage({ ...dasar, discountAmount: 5_000 })
    ).toContain("Diskon");
  });

  it("footer ikut konfigurasi struk; tanpa konfigurasi pakai teks lama (EPIC-040)", () => {
    expect(buildOrderReceiptMessage(dasar)).toContain("Terima kasih atas kunjungan Anda");
    const pesan = buildOrderReceiptMessage({
      ...dasar,
      footerLines: ["Sampai jumpa lagi!", "WiFi: SULU-GUEST"],
    });
    expect(pesan).toContain("Sampai jumpa lagi!");
    expect(pesan).toContain("WiFi: SULU-GUEST");
    expect(pesan).not.toContain("Terima kasih atas kunjungan Anda");
  });
});

describe("buildTopupReceiptMessage", () => {
  it("memuat nama, nominal, dan saldo akhir", () => {
    const pesan = buildTopupReceiptMessage({
      outletName: "Sulu",
      customerName: "Budi",
      amount: 100_000,
      method: "cash",
      balanceAfter: 150_000,
      at: "2026-08-14T12:30:00+07:00",
    });
    expect(pesan).toContain("Budi");
    expect(pesan).toContain("Rp 100.000");
    expect(pesan).toContain("Rp 150.000");
  });

  it("saldo akhir tidak diketahui → barisnya hilang, bukan 'Rp 0' yang menakutkan", () => {
    const pesan = buildTopupReceiptMessage({
      outletName: "Sulu",
      customerName: "Budi",
      amount: 100_000,
      method: "cash",
      balanceAfter: null,
      at: "2026-08-14T12:30:00+07:00",
    });
    expect(pesan).not.toContain("Saldo");
  });
});

describe("buildShiftReportMessage", () => {
  it("memuat angka-angka inti tutup kasir", () => {
    const pesan = buildShiftReportMessage({
      outletName: "Sulu",
      shiftNumber: "SH-014",
      cashierName: "Ani",
      openedAt: "2026-08-14T08:00:00+07:00",
      closedAt: "2026-08-14T16:00:00+07:00",
      totalOrders: 42,
      totalSales: 3_500_000,
      openingCash: 500_000,
      expectedCash: 2_100_000,
      closingCash: 2_095_000,
      variance: -5_000,
    });
    expect(pesan).toContain("SH-014");
    expect(pesan).toContain("Ani");
    expect(pesan).toContain("42");
    expect(pesan).toContain("Rp 3.500.000");
    expect(pesan).toContain("-Rp 5.000"); // selisih minus harus jujur, bukan disembunyikan
  });

  it("selisih nol ditulis pas, bukan minus", () => {
    const pesan = buildShiftReportMessage({
      outletName: "Sulu",
      shiftNumber: "SH-015",
      cashierName: "Ani",
      openedAt: "2026-08-14T08:00:00+07:00",
      closedAt: "2026-08-14T16:00:00+07:00",
      totalOrders: 1,
      totalSales: 10_000,
      openingCash: 0,
      expectedCash: 10_000,
      closingCash: 10_000,
      variance: 0,
    });
    expect(pesan).toContain("pas");
  });
});

describe("buildMemberBillReminderMessage", () => {
  const base = {
    outletName: "BCD Coffee",
    customerName: "Budi",
    at: "2026-10-01T12:00:00.000Z",
    orders: [
      { orderNumber: "POS-20260928-0001", orderedAt: "2026-09-28T07:30:00.000Z", total: 25000 },
      { orderNumber: "POS-20261001-0002", orderedAt: "2026-10-01T10:19:00.000Z", total: 622000 },
    ],
    openTotal: 647000,
    paid: 400000,
    outstanding: 247000,
  };

  it("memuat daftar order, total, yang sudah dibayar, dan sisa tagihan", () => {
    const message = buildMemberBillReminderMessage(base);
    expect(message).toContain("Halo *Budi*");
    expect(message).toContain("*BCD Coffee*");
    expect(message).toContain("1. POS-20260928-0001");
    expect(message).toContain("Rp 25.000");
    expect(message).toContain("Total order: Rp 647.000");
    expect(message).toContain("Sudah dibayar: Rp 400.000");
    expect(message).toContain("*Sisa tagihan: Rp 247.000*");
  });

  it("belum ada cicilan → baris 'Sudah dibayar' tidak muncul; order banyak diringkas", () => {
    const orders = Array.from({ length: MEMBER_BILL_WA_MAX_ORDERS + 3 }, (_, i) => ({
      orderNumber: `POS-${i}`,
      orderedAt: "2026-10-01T10:00:00.000Z",
      total: 1000,
    }));
    const message = buildMemberBillReminderMessage({ ...base, orders, paid: 0 });
    expect(message).not.toContain("Sudah dibayar");
    expect(message).toContain("… dan 3 order lainnya");
    expect(message).not.toContain(`POS-${MEMBER_BILL_WA_MAX_ORDERS}`);
  });
});
