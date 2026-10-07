import { describe, expect, it } from "vitest";
import { buildAskDoPrompt } from "./ask-do";
import { emptyDesktopOverview, type DesktopOverview } from "./overview";

const kosong: DesktopOverview = {
  ...emptyDesktopOverview(),
  dibuatPada: "2026-07-25T02:00:00.000Z",
};

function withPulsa(hariIni: number, kemarin: number, mingguLalu = 0): DesktopOverview {
  return {
    ...kosong,
    pulsaBisnis: {
      hariIni: { omzet: hariIni, pesanan: 5, rataRata: hariIni / 5 },
      labaKotorHariIni: null,
      kemarin: { omzet: kemarin, pesanan: 4 },
      mingguLalu: { omzet: mingguLalu, pesanan: 3 },
      tujuhHari: [],
    },
  };
}

describe("buildAskDoPrompt — pulsa", () => {
  it("omzet turun → pertanyaan 'kenapa turun' dengan persen", () => {
    const prompt = buildAskDoPrompt("pulsa", withPulsa(650_000, 1_000_000));
    expect(prompt).toContain("turun 35%");
    expect(prompt).toContain("Kenapa bisa turun");
  });

  it("omzet naik → pertanyaan pendorong, plus pembanding minggu lalu", () => {
    const prompt = buildAskDoPrompt("pulsa", withPulsa(1_200_000, 1_000_000, 800_000));
    expect(prompt).toContain("naik 20% dibanding kemarin");
    expect(prompt).toContain("naik 50% vs hari yang sama minggu lalu");
    expect(prompt).toContain("pendorong");
  });

  it("kemarin nol → tanpa persen (hindari bagi nol), tetap menyebut omzet", () => {
    const prompt = buildAskDoPrompt("pulsa", withPulsa(500_000, 0));
    expect(prompt).not.toContain("%");
    expect(prompt).toContain("Rp 500.000");
  });

  it("data null → pertanyaan generik", () => {
    expect(buildAskDoPrompt("pulsa", null)).toContain("penjualan hari ini");
  });
});

describe("buildAskDoPrompt — tim", () => {
  it("ada yang belum absen → sebut jumlahnya", () => {
    const prompt = buildAskDoPrompt("tim", {
      ...kosong,
      timHariIni: { aktif: 19, hadir: 14, terlambat: 2, cuti: 1, belum: 4 },
    });
    expect(prompt).toContain("4 karyawan yang belum absen");
    expect(prompt).toContain("hadir 14 dari 19");
  });

  it("semua hadir tapi ada telat → fokus keterlambatan", () => {
    const prompt = buildAskDoPrompt("tim", {
      ...kosong,
      timHariIni: { aktif: 10, hadir: 10, terlambat: 3, cuti: 0, belum: 0 },
    });
    expect(prompt).toContain("3 orang terlambat");
  });
});

describe("buildAskDoPrompt — keputusan", () => {
  it("merinci hanya kategori yang berisi", () => {
    const prompt = buildAskDoPrompt("keputusan", {
      ...kosong,
      perluKeputusan: { cuti: 2, lembur: 0, pinjaman: 1, poDraft: 0, kandidatBaru: 3, total: 6 },
    });
    expect(prompt).toContain("6 item menunggu keputusan");
    expect(prompt).toContain("2 cuti, 1 pinjaman, 3 kandidat baru");
    expect(prompt).not.toContain("lembur");
  });

  it("tidak ada yang pending → pertanyaan generik", () => {
    const prompt = buildAskDoPrompt("keputusan", {
      ...kosong,
      perluKeputusan: { cuti: 0, lembur: 0, pinjaman: 0, poDraft: 0, kandidatBaru: 0, total: 0 },
    });
    expect(prompt).toContain("menunggu keputusan saya");
  });
});

describe("buildAskDoPrompt — stok & member", () => {
  it("stok menipis → sebut jumlah dan bahan paling kritis", () => {
    const prompt = buildAskDoPrompt("stok", {
      ...kosong,
      stokMenipis: {
        jumlah: 5,
        teratas: [
          { bahan: "Gula Aren", tersedia: 2, minimum: 10 },
          { bahan: "Susu UHT", tersedia: 1, minimum: 6 },
        ],
      },
    });
    expect(prompt).toContain("5 bahan di bawah batas minimum");
    expect(prompt).toContain("Gula Aren, Susu UHT");
  });

  it("stok aman → pertanyaan generik", () => {
    const prompt = buildAskDoPrompt("stok", { ...kosong, stokMenipis: { jumlah: 0, teratas: [] } });
    expect(prompt).toContain("kondisi stok");
  });

  it("member → menyebut angka 7 hari terakhir", () => {
    const prompt = buildAskDoPrompt("member", {
      ...kosong,
      member: { memberBaru7Hari: 5, xpTerdistribusi7Hari: 12500, rewardDitukar7Hari: 2 },
    });
    expect(prompt).toContain("5 member baru");
    expect(prompt).toContain("12.500 XP");
  });
});
