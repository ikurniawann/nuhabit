import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

import { buildExecutiveDashboard } from "./executive";

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
});

describe("buildExecutiveDashboard", () => {
  it("tren selalu 14 titik berurutan meski data bolong", async () => {
    queryMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue({});
    const d = await buildExecutiveDashboard();
    expect(d.tren14Hari).toHaveLength(14);
    for (let i = 1; i < 14; i++) {
      expect(new Date(d.tren14Hari![i].tanggal) > new Date(d.tren14Hari![i - 1].tanggal)).toBe(true);
    }
  });

  it("satu seksi eksekutif gagal tidak menjatuhkan sisanya", async () => {
    // Semua query array gagal (tren, top produk, purchasing, stok overview dll)
    queryMock.mockRejectedValue(new Error("db seksi mati"));
    queryOneMock.mockResolvedValue({});
    const d = await buildExecutiveDashboard();
    expect(d.tren14Hari).toBeNull();
    expect(d.gagal).toContain("tren14");
    expect(d.gagal).toContain("topProduk");
    // seksi berbasis queryOne tetap hidup
    expect(d.kontrakHabis30Hari).not.toBeNull();
    expect(d.payrollTerakhir === null || typeof d.payrollTerakhir === "object").toBe(true);
  });

  it("payroll null saat belum pernah ada run — bukan objek kosong", async () => {
    queryMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue(null);
    const d = await buildExecutiveDashboard();
    expect(d.payrollTerakhir).toBeNull();
    expect(d.gagal).not.toContain("payroll");
  });

  it("kegagalan overview ikut tercatat dengan prefix", async () => {
    queryMock.mockRejectedValue(new Error("mati"));
    queryOneMock.mockRejectedValue(new Error("mati"));
    const d = await buildExecutiveDashboard();
    expect(d.gagal.some((g) => g.startsWith("overview:"))).toBe(true);
  });
});
