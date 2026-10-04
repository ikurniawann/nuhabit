import { describe, expect, it } from "vitest";

import { PERIOD_KINDS, projectRunRate, resolveComparison, resolvePeriod } from "./period";

/**
 * Tes ditulis LEBIH DULU (EPIC-037 Fase A).
 *
 * Alasannya: kesalahan pembanding periode parsial tidak kelihatan di layar.
 * MTD 15 hari yang dibandingkan dengan bulan lalu PENUH akan membuat setiap
 * bulan tampak anjlok ~50%, dan owner akan mempercayainya. Kasus batas
 * (akhir bulan panjang vs Februari, tahun kabisat, pergantian kuartal) adalah
 * tempat bug itu hidup.
 */

describe("resolvePeriod", () => {
  it("today: satu hari, run-rate tidak memproyeksikan apa pun", () => {
    const p = resolvePeriod("today", new Date("2026-07-15T05:00:00Z"));

    expect(p).toMatchObject({ mulai: "2026-07-15", selesai: "2026-07-15" });
    expect(p.hariBerjalan).toBe(1);
    expect(p.totalHari).toBe(1);
  });

  it("menggeser ke WIB sebelum menentukan tanggal", () => {
    // 23:30 UTC = 06:30 WIB hari BERIKUTNYA. Tanpa pergeseran ini, papan owner
    // menampilkan "hari ini" yang sudah lewat bagi penggunanya.
    const p = resolvePeriod("today", new Date("2026-07-15T23:30:00Z"));
    expect(p.mulai).toBe("2026-07-16");
  });

  it("mtd: dari tanggal 1 sampai hari ini, totalHari = panjang bulan", () => {
    const p = resolvePeriod("mtd", new Date("2026-07-15T05:00:00Z"));

    expect(p).toMatchObject({ mulai: "2026-07-01", selesai: "2026-07-15" });
    expect(p.hariBerjalan).toBe(15);
    expect(p.totalHari).toBe(31);
  });

  it("qtd: mulai dari awal kuartal berjalan", () => {
    const q3 = resolvePeriod("qtd", new Date("2026-08-10T05:00:00Z"));
    expect(q3.mulai).toBe("2026-07-01");
    expect(q3.totalHari).toBe(31 + 31 + 30); // Jul+Ags+Sep

    // Hari pertama kuartal: batas yang mudah salah jadi kuartal sebelumnya.
    const awalQ2 = resolvePeriod("qtd", new Date("2026-04-01T05:00:00Z"));
    expect(awalQ2.mulai).toBe("2026-04-01");
    expect(awalQ2.hariBerjalan).toBe(1);
  });

  it("ytd: dari 1 Januari, dan sadar tahun kabisat", () => {
    const biasa = resolvePeriod("ytd", new Date("2026-03-01T05:00:00Z"));
    expect(biasa.mulai).toBe("2026-01-01");
    expect(biasa.hariBerjalan).toBe(31 + 28 + 1);
    expect(biasa.totalHari).toBe(365);

    const kabisat = resolvePeriod("ytd", new Date("2028-03-01T05:00:00Z"));
    expect(kabisat.hariBerjalan).toBe(31 + 29 + 1);
    expect(kabisat.totalHari).toBe(366);
  });
});

describe("resolveComparison — apples-to-apples", () => {
  it("today dibandingkan hari yang sama minggu lalu, bukan kemarin", () => {
    // Pola weekend/weekday mendominasi; Sabtu vs Jumat menyesatkan.
    const p = resolvePeriod("today", new Date("2026-07-15T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2026-07-08", selesai: "2026-07-08" });
    expect(c.penuh).toBe(true);
  });

  it("mtd 1–15 Juli dibandingkan 1–15 Juni, BUKAN Juni penuh", () => {
    const p = resolvePeriod("mtd", new Date("2026-07-15T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2026-06-01", selesai: "2026-06-15" });
    expect(c.hariBanding).toBe(15);
    expect(c.penuh).toBe(true);
  });

  it("mtd 31 Maret: Februari tidak punya tanggal 31, jendela dipotong dan ditandai", () => {
    // Inilah kasus yang membuat pembanding jadi tidak adil tanpa disadari:
    // 31 hari dibandingkan 28 hari. Widget WAJIB tahu ini lewat penuh=false.
    const p = resolvePeriod("mtd", new Date("2026-03-31T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2026-02-01", selesai: "2026-02-28" });
    expect(p.hariBerjalan).toBe(31);
    expect(c.hariBanding).toBe(28);
    expect(c.penuh).toBe(false);
  });

  it("mtd 29 Februari tahun kabisat dibandingkan Januari yang punya 29", () => {
    const p = resolvePeriod("mtd", new Date("2028-02-29T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2028-01-01", selesai: "2028-01-29" });
    expect(c.penuh).toBe(true);
  });

  it("qtd dibandingkan kuartal sebelumnya pada jumlah hari yang sama", () => {
    const p = resolvePeriod("qtd", new Date("2026-07-10T05:00:00Z")); // Q3 hari ke-10
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2026-04-01", selesai: "2026-04-10" });
    expect(c.hariBanding).toBe(10);
  });

  it("qtd di Q1 mundur ke Q4 tahun sebelumnya", () => {
    const p = resolvePeriod("qtd", new Date("2026-01-05T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c.mulai).toBe("2025-10-01");
    expect(c.selesai).toBe("2025-10-05");
  });

  it("ytd dibandingkan YTD tahun lalu pada tanggal yang sama", () => {
    const p = resolvePeriod("ytd", new Date("2026-07-15T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2025-01-01", selesai: "2025-07-15" });
  });

  it("ytd pada 29 Feb kabisat mundur ke 28 Feb tahun biasa dan ditandai tidak penuh", () => {
    const p = resolvePeriod("ytd", new Date("2028-02-29T05:00:00Z"));
    const c = resolveComparison(p);

    expect(c).toMatchObject({ mulai: "2027-01-01", selesai: "2027-02-28" });
    expect(c.penuh).toBe(false);
  });
});

describe("projectRunRate", () => {
  it("memproyeksikan sisa periode dari laju berjalan", () => {
    const p = resolvePeriod("mtd", new Date("2026-07-15T05:00:00Z")); // 15 dari 31 hari
    // 15 juta dalam 15 hari → 1 juta/hari → 31 juta sebulan.
    expect(projectRunRate(15_000_000, p)).toBe(31_000_000);
  });

  it("today tidak diproyeksikan — nilainya sudah final", () => {
    const p = resolvePeriod("today", new Date("2026-07-15T05:00:00Z"));
    expect(projectRunRate(2_500_000, p)).toBe(2_500_000);
  });

  it("nol hari berjalan tidak menghasilkan Infinity/NaN", () => {
    // Penjaga pembagian nol: papan owner tidak boleh menampilkan "Rp NaN".
    const p = { ...resolvePeriod("mtd", new Date("2026-07-15T05:00:00Z")), hariBerjalan: 0 };
    expect(projectRunRate(1_000, p)).toBe(0);
  });
});

describe("PERIOD_KINDS", () => {
  it("berisi empat periode papan", () => {
    expect(PERIOD_KINDS).toEqual(["today", "mtd", "qtd", "ytd"]);
  });
});
