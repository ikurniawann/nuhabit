import { describe, expect, it } from "vitest";
import { emptyDesktopOverview, type DesktopOverview } from "@/lib/desktop/overview";
import {
  buildApprovalMenginapMessage,
  buildDigestMessage,
  buildKomplainMessage,
  buildKontrakHabisMessage,
  buildOmzetAnjlokMessage,
  buildReviewRendahMessage,
  buildStokHabisMessage,
  buildVoidBesarMessage,
  digestDedupKey,
  hourWib,
  isoWeekWib,
  komplainDedupKey,
  kontrakHabisDedupKey,
  omzetAnjlokDedupKey,
  reviewRendahDedupKey,
  stokHabisDedupKey,
  todayWib,
  voidDedupKey,
  buildPrMendesakMessage,
  prMendesakDedupKey,
} from "./notifications-messages";

const overviewKosong: DesktopOverview = {
  ...emptyDesktopOverview(),
  dibuatPada: "2026-07-22T15:00:00.000Z",
  gagal: ["pulsaBisnis"],
};

describe("waktu WIB", () => {
  it("todayWib menggeser +7 jam — jam 20:00 UTC = besok WIB", () => {
    expect(todayWib(new Date("2026-07-22T20:00:00Z"))).toBe("2026-07-23");
    expect(todayWib(new Date("2026-07-22T10:00:00Z"))).toBe("2026-07-22");
  });

  it("hourWib mengembalikan jam lokal Jakarta", () => {
    expect(hourWib(new Date("2026-07-22T15:00:00Z"))).toBe(22);
    expect(hourWib(new Date("2026-07-22T18:30:00Z"))).toBe(1);
  });
});

describe("kunci dedup", () => {
  it("unik per kejadian", () => {
    expect(digestDedupKey("2026-07-22")).toBe("2026-07-22");
    expect(voidDedupKey("abc")).toBe("abc");
    expect(stokHabisDedupKey("m1", "2026-07-22")).toBe("m1:2026-07-22");
    expect(stokHabisDedupKey("m1", "2026-07-23")).not.toBe(
      stokHabisDedupKey("m1", "2026-07-22")
    );
  });
});

describe("buildVoidBesarMessage", () => {
  it("memuat nomor order, nominal terformat, alasan & penyetuju", () => {
    const msg = buildVoidBesarMessage({
      orderNumber: "ORD-0042",
      total: 750_000,
      reason: "salah input menu",
      supervisorName: "Budi",
    });
    expect(msg).toContain("ORD-0042");
    expect(msg).toContain("Rp750.000");
    expect(msg).toContain("salah input menu");
    expect(msg).toContain("Budi");
  });

  it("alasan panjang dipotong — pesan WA tidak meledak", () => {
    const msg = buildVoidBesarMessage({
      orderNumber: "X",
      total: 1,
      reason: "a".repeat(500),
      supervisorName: "S",
    });
    expect(msg.length).toBeLessThan(500);
  });
});

describe("buildStokHabisMessage", () => {
  it("mendaftar semua bahan dengan satuannya", () => {
    const msg = buildStokHabisMessage([
      { nama: "Ayam Fillet", satuan: "kg" },
      { nama: "Gula", satuan: null },
    ]);
    expect(msg).toContain("2 bahan");
    expect(msg).toContain("• Ayam Fillet (kg)");
    expect(msg).toContain("• Gula");
    expect(msg).not.toContain("(null)");
  });
});

describe("buildDigestMessage", () => {
  it("semua seksi gagal → pesan tetap terbentuk tanpa angka nol palsu", () => {
    const msg = buildDigestMessage(overviewKosong, "2026-07-22");
    expect(msg).toContain("Ringkasan Harian");
    expect(msg).toContain("Belum ada data hari ini.");
    expect(msg).not.toContain("Omzet:");
  });

  it("omzet naik/turun vs kemarin ditampilkan sebagai persen", () => {
    const overview: DesktopOverview = {
      ...overviewKosong,
      pulsaBisnis: {
        hariIni: { omzet: 1_200_000, pesanan: 10, rataRata: 120_000 },
        kemarin: { omzet: 1_000_000, pesanan: 8 },
        mingguLalu: { omzet: 0, pesanan: 0 },
        tujuhHari: [],
      },
    };
    const msg = buildDigestMessage(overview, "2026-07-22");
    expect(msg).toContain("Rp1.200.000");
    expect(msg).toContain("▲ 20% vs kemarin");
  });

  it("kemarin nol → tanpa pembanding (hindari bagi nol)", () => {
    const overview: DesktopOverview = {
      ...overviewKosong,
      pulsaBisnis: {
        hariIni: { omzet: 500_000, pesanan: 3, rataRata: 166_667 },
        kemarin: { omzet: 0, pesanan: 0 },
        mingguLalu: { omzet: 0, pesanan: 0 },
        tujuhHari: [],
      },
    };
    const msg = buildDigestMessage(overview, "2026-07-22");
    expect(msg).toContain("Rp500.000");
    expect(msg).not.toContain("vs kemarin");
  });

  it("antrean keputusan & stok menipis hanya tampil bila ada", () => {
    const overview: DesktopOverview = {
      ...overviewKosong,
      perluKeputusan: {
        cuti: 2,
        lembur: 0,
        pinjaman: 1,
        poDraft: 0,
        kandidatBaru: 0,
        total: 3,
      },
      stokMenipis: {
        jumlah: 2,
        teratas: [
          { bahan: "Ayam", tersedia: 1, minimum: 5 },
          { bahan: "Gula", tersedia: 0.5, minimum: 2 },
        ],
      },
    };
    const msg = buildDigestMessage(overview, "2026-07-22");
    expect(msg).toContain("Menunggu keputusan:* 3 (2 cuti, 1 pinjaman)");
    expect(msg).toContain("Stok menipis:* 2 bahan (Ayam, Gula)");

    const tanpaAntrean = buildDigestMessage(
      { ...overviewKosong, perluKeputusan: { cuti: 0, lembur: 0, pinjaman: 0, poDraft: 0, kandidatBaru: 0, total: 0 } },
      "2026-07-22"
    );
    expect(tanpaAntrean).not.toContain("Menunggu keputusan");
  });
});

describe("Fase C+D — formatter & kunci baru", () => {
  it("isoWeekWib konsisten dalam satu minggu, beda antar minggu", () => {
    // Senin & Minggu di minggu ISO yang sama (WIB)
    expect(isoWeekWib(new Date("2026-07-20T03:00:00Z"))).toBe(
      isoWeekWib(new Date("2026-07-26T03:00:00Z"))
    );
    expect(isoWeekWib(new Date("2026-07-20T03:00:00Z"))).not.toBe(
      isoWeekWib(new Date("2026-07-27T03:00:00Z"))
    );
    // Jam 20:00 UTC Minggu = Senin WIB → sudah minggu berikutnya
    expect(isoWeekWib(new Date("2026-07-26T20:00:00Z"))).toBe(
      isoWeekWib(new Date("2026-07-27T03:00:00Z"))
    );
  });

  it("buildKomplainMessage jatuh ke nomor bila nama kosong", () => {
    const msg = buildKomplainMessage({
      displayName: null,
      phone: "6281200011122",
      category: "produk",
      priority: "tinggi",
    });
    expect(msg).toContain("6281200011122");
    expect(msg).toContain("produk");
    expect(msg).toContain("tinggi");
  });

  it("buildReviewRendahMessage memuat bintang & memotong komentar panjang", () => {
    const msg = buildReviewRendahMessage({
      reviewerName: "Andi",
      starRating: 1,
      comment: "x".repeat(1000),
    });
    expect(msg).toContain("(1/5)");
    expect(msg).toContain("Andi");
    expect(msg.length).toBeLessThan(600);
  });

  it("buildOmzetAnjlokMessage membedakan sumber target vs bulan lalu", () => {
    const vsTarget = buildOmzetAnjlokMessage({
      mtd: 4_000_000,
      baseline: 10_000_000,
      pct: 40,
      source: "target",
      hariBerjalan: 21,
    });
    expect(vsTarget).toContain("40%");
    expect(vsTarget).toContain("pace target bulanan");
    expect(vsTarget).toContain("tgl 1–21");

    const vsBulanLalu = buildOmzetAnjlokMessage({
      mtd: 4_000_000,
      baseline: 10_000_000,
      pct: 40,
      source: "bulan-lalu",
      hariBerjalan: 21,
    });
    expect(vsBulanLalu).toContain("bulan lalu");
  });

  it("buildApprovalMenginapMessage hanya mendaftar jenis yang ada", () => {
    const msg = buildApprovalMenginapMessage({
      cuti: 3,
      lembur: 0,
      pinjaman: 1,
      poDraft: 0,
    });
    expect(msg).toContain("4 pengajuan");
    expect(msg).toContain("3 pengajuan cuti");
    expect(msg).not.toContain("lembur");
  });

  it("buildKontrakHabisMessage menandai yang sudah lewat", () => {
    const msg = buildKontrakHabisMessage([
      { employeeName: "Budi", endDate: "2026-08-10", daysLeft: 19 },
      { employeeName: "Sari", endDate: "2026-07-20", daysLeft: -2 },
    ]);
    expect(msg).toContain("2 kontrak");
    expect(msg).toContain("Budi");
    expect(msg).toContain("19 hari lagi");
    expect(msg).toContain("SUDAH LEWAT");
  });

  it("kunci dedup baru unik per kejadian", () => {
    
    expect(komplainDedupKey("c1")).toBe("c1");
    expect(reviewRendahDedupKey("r1")).toBe("r1");
    expect(omzetAnjlokDedupKey("2026-W30")).toBe("2026-W30");
    expect(kontrakHabisDedupKey("k1", "2026-08-01")).not.toBe(
      kontrakHabisDedupKey("k1", "2026-09-01")
    );
  });
});

describe("PR mendesak", () => {
  it("dedup per PR per status", () => {
    expect(prMendesakDedupKey("pr-1", "draft")).toBe("pr-1:draft");
    expect(prMendesakDedupKey("pr-1", "pending_head")).toBe("pr-1:pending_head");
  });

  it("pesan memuat nomor PR, pemohon, total, tanggal butuh, dan item (maks 5)", () => {
    const msg = buildPrMendesakMessage({
      prNumber: "PR-202609-0007",
      status: "pending_head",
      requesterName: "Erik Hidayat",
      departmentName: "Produksi",
      totalAmount: 2500000,
      requiredDate: "2026-09-06",
      notes: "Stok kulit habis",
      items: Array.from({ length: 7 }, (_, i) => ({ description: `Bahan ${i + 1}`, qty: 10, unit: "M" })),
    });
    expect(msg).toContain("MENDESAK");
    expect(msg).toContain("PR-202609-0007 diajukan");
    expect(msg).toContain("Erik Hidayat · Produksi");
    expect(msg).toContain("Rp2.500.000");
    expect(msg).toContain("2026-09-06");
    expect(msg).toContain("Bahan 5 — 10 M");
    expect(msg).not.toContain("Bahan 6 —");
    expect(msg).toContain("dan 2 item lain");
    expect(msg).toContain("menyetujui");
  });

  it("draft ditandai sebagai draft dan mengajak meninjau", () => {
    const msg = buildPrMendesakMessage({
      prNumber: "PR-1", status: "draft", requesterName: "A", totalAmount: 0, items: [],
    });
    expect(msg).toContain("dibuat (draft)");
    expect(msg).toContain("meninjau");
  });
});

describe("tanggal pesan WA = tanggal WIB, apa pun zona waktu server", () => {
  it("judul Ringkasan Harian 2026-10-01 → Kamis, 1 Oktober 2026", () => {
    const msg = buildDigestMessage(overviewKosong, "2026-10-01");
    expect(msg).toContain("Ringkasan Harian — Kamis, 1 Oktober 2026");
  });
});
