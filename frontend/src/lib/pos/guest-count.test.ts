import { describe, expect, it } from "vitest";

import {
  DEFAULT_GUEST_COUNT,
  capacityWarning,
  normalizeGuestCount,
} from "./guest-count";

/**
 * Tes ditulis lebih dulu (EPIC-038).
 *
 * Yang dijaga: input kasir tidak pernah bisa menghasilkan pesanan dengan
 * jumlah tamu yang tidak masuk akal. Kasir mengetik cepat di tengah antrean —
 * field kosong, spasi, "2 orang", bahkan "0" adalah kejadian sehari-hari, bukan
 * kasus tepi.
 */

describe("normalizeGuestCount", () => {
  it("kosong, null, undefined → default 1 orang", () => {
    expect(normalizeGuestCount(undefined)).toBe(1);
    expect(normalizeGuestCount(null)).toBe(1);
    expect(normalizeGuestCount("")).toBe(1);
    expect(normalizeGuestCount("   ")).toBe(1);
    expect(DEFAULT_GUEST_COUNT).toBe(1);
  });

  it("menerima angka maupun teks angka", () => {
    expect(normalizeGuestCount(4)).toBe(4);
    expect(normalizeGuestCount("6")).toBe(6);
    expect(normalizeGuestCount(" 8 ")).toBe(8);
  });

  it("nol dan negatif jatuh ke 1 — 'nol orang duduk' tidak punya arti", () => {
    expect(normalizeGuestCount(0)).toBe(1);
    expect(normalizeGuestCount(-3)).toBe(1);
    expect(normalizeGuestCount("0")).toBe(1);
  });

  it("desimal dibulatkan ke bawah — tidak ada setengah orang", () => {
    expect(normalizeGuestCount(2.9)).toBe(2);
    expect(normalizeGuestCount("3.7")).toBe(3);
    // Hasil pembulatan yang jatuh ke 0 tetap naik ke 1.
    expect(normalizeGuestCount(0.4)).toBe(1);
  });

  it("teks non-angka → 1, bukan NaN", () => {
    // Tanpa penjaga ini, NaN lolos ke INSERT dan ditolak database saat kasir
    // sedang melayani tamu — kegagalan di saat paling buruk.
    expect(normalizeGuestCount("dua orang")).toBe(1);
    expect(normalizeGuestCount({})).toBe(1);
    expect(normalizeGuestCount(NaN)).toBe(1);
    expect(normalizeGuestCount(Infinity)).toBe(1);
  });

  it("dibatasi wajar di atas supaya salah ketik tidak jadi data sampah", () => {
    // "66" untuk "6" masih lolos (bisa jadi rombongan), tapi 1000 jelas
    // salah ketik. Batas ada supaya laporan tidak rusak oleh satu kekeliruan.
    expect(normalizeGuestCount(500)).toBe(500);
    expect(normalizeGuestCount(1000)).toBe(500);
    expect(normalizeGuestCount("99999")).toBe(500);
  });
});

describe("capacityWarning", () => {
  it("diam saat tamu masih dalam kapasitas", () => {
    expect(capacityWarning(4, 4)).toBeNull();
    expect(capacityWarning(2, 4)).toBeNull();
  });

  it("memperingatkan saat melebihi kapasitas, tapi ini bukan blokir", () => {
    const pesan = capacityWarning(6, 4);
    expect(pesan).toContain("6");
    expect(pesan).toContain("4");
  });

  it("kapasitas tidak diketahui → tidak ada peringatan", () => {
    // Meja tanpa kapasitas tercatat: diam lebih baik daripada peringatan palsu.
    expect(capacityWarning(10, null)).toBeNull();
    expect(capacityWarning(10, undefined)).toBeNull();
    expect(capacityWarning(10, 0)).toBeNull();
  });
});
