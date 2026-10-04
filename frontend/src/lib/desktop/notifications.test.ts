import { describe, expect, it } from "vitest";
import { diffOverviewNotifications } from "./notifications";
import { emptyDesktopOverview, type DesktopOverview } from "./overview";

function snapshot(over: Partial<{
  cuti: number; lembur: number; pinjaman: number; poDraft: number; kandidatBaru: number;
  stok: number; pesanan: number; member: number;
}> = {}): DesktopOverview {
  const p = {
    cuti: over.cuti ?? 0,
    lembur: over.lembur ?? 0,
    pinjaman: over.pinjaman ?? 0,
    poDraft: over.poDraft ?? 0,
    kandidatBaru: over.kandidatBaru ?? 0,
  };
  return {
    ...emptyDesktopOverview(),
    dibuatPada: "2026-07-21T02:00:00.000Z",
    pulsaBisnis: {
      hariIni: { omzet: 0, pesanan: over.pesanan ?? 0, rataRata: 0 },
      labaKotorHariIni: null,
      kemarin: { omzet: 0, pesanan: 0 },
      mingguLalu: { omzet: 0, pesanan: 0 },
      tujuhHari: [],
    },
    timHariIni: { aktif: 10, hadir: 5, terlambat: 0, cuti: 0, belum: 5 },
    perluKeputusan: { ...p, total: p.cuti + p.lembur + p.pinjaman + p.poDraft + p.kandidatBaru },
    stokMenipis: { jumlah: over.stok ?? 0, teratas: [] },
    member: { memberBaru7Hari: over.member ?? 0, xpTerdistribusi7Hari: 0, rewardDitukar7Hari: 0 },
    gagal: [],
  };
}

describe("diffOverviewNotifications — snapshot pertama", () => {
  it("melaporkan antrean yang sudah menunggu", () => {
    const out = diffOverviewNotifications(null, snapshot({ cuti: 3, stok: 2 }));
    expect(out.map((n) => n.text)).toEqual([
      "3 pengajuan cuti menunggu keputusan",
      "2 bahan baku di bawah stok minimum",
    ]);
  });

  it("diam saat tidak ada apa-apa", () => {
    expect(diffOverviewNotifications(null, snapshot())).toEqual([]);
  });

  it("pesanan & member yang sudah ada bukan berita di snapshot pertama", () => {
    // Owner membuka desktop siang hari: 27 pesanan sudah terjadi, itu keadaan,
    // bukan kejadian baru.
    expect(diffOverviewNotifications(null, snapshot({ pesanan: 27, member: 5 }))).toEqual([]);
  });
});

describe("diffOverviewNotifications — antar poll", () => {
  it("kenaikan melahirkan notifikasi dengan delta yang benar", () => {
    const out = diffOverviewNotifications(snapshot({ pesanan: 27 }), snapshot({ pesanan: 30 }));
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("3 pesanan baru masuk di POS");
    expect(out[0].href).toBe("/dashboard/pos");
  });

  it("penurunan tidak bersuara — antrean berkurang itu hasil kerja", () => {
    expect(diffOverviewNotifications(snapshot({ cuti: 3 }), snapshot({ cuti: 1 }))).toEqual([]);
  });

  it("angka tetap tidak bersuara", () => {
    expect(diffOverviewNotifications(snapshot({ cuti: 3 }), snapshot({ cuti: 3 }))).toEqual([]);
  });

  it("beberapa kenaikan sekaligus = beberapa notifikasi", () => {
    const out = diffOverviewNotifications(
      snapshot(),
      snapshot({ cuti: 1, poDraft: 2, member: 1 })
    );
    expect(out.map((n) => n.text).sort()).toEqual(
      [
        "1 pengajuan cuti baru masuk",
        "2 PO draft baru menunggu approval",
        "1 member baru bergabung",
      ].sort()
    );
  });

  it("seksi yang gagal di salah satu snapshot tidak mengarang delta", () => {
    const sakit = snapshot({ cuti: 5 });
    sakit.perluKeputusan = null; // seksi gagal dimuat
    // gagal → sehat: tanpa pembanding, jangan klaim "5 baru masuk"
    expect(diffOverviewNotifications(sakit, snapshot({ cuti: 5 }))).toEqual([]);
    // sehat → gagal: tidak ada angka baru, diam
    expect(diffOverviewNotifications(snapshot({ cuti: 5 }), sakit)).toEqual([]);
  });

  it("id unik meski lahir bersamaan", () => {
    const out = diffOverviewNotifications(snapshot(), snapshot({ cuti: 1, lembur: 1 }));
    expect(new Set(out.map((n) => n.id)).size).toBe(out.length);
  });
});
