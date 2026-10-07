import { describe, expect, it } from "vitest";
import {
  allocateFefo,
  daysBetween,
  defaultExpiryDate,
  expiryState,
  sortFefo,
  summarizeExpiry,
  toDateOnly,
  todayJakarta,
  type StockBatch,
} from "./batches";

const TODAY = "2026-10-03";

function batch(id: string, expiryDate: string | null, qty: number, receivedAt = "2026-09-01T00:00:00Z", unitCost = 100): StockBatch {
  return { id, batchNumber: id.toUpperCase(), expiryDate, qtyRemaining: qty, unitCost, receivedAt };
}

describe("allocateFefo", () => {
  it("mengambil batch dengan tanggal terdekat lebih dulu, bukan yang datang lebih dulu", () => {
    const result = allocateFefo(
      [batch("lama-jauh", "2026-12-01", 10, "2026-08-01T00:00:00Z"), batch("baru-dekat", "2026-10-10", 4, "2026-09-20T00:00:00Z")],
      6,
      TODAY
    );
    expect(result.allocations.map((a) => [a.batchId, a.qty])).toEqual([
      ["baru-dekat", 4],
      ["lama-jauh", 2],
    ]);
    expect(result.shortfall).toBe(0);
    expect(result.allocations[1]).toMatchObject({ qtyBefore: 10, qtyAfter: 8 });
  });

  it("batch tanpa tanggal dipakai paling akhir", () => {
    const result = allocateFefo([batch("tanpa", null, 5), batch("dekat", "2026-10-05", 1)], 3, TODAY);
    expect(result.allocations.map((a) => a.batchId)).toEqual(["dekat", "tanpa"]);
  });

  it("melewati batch kedaluwarsa dan melaporkannya", () => {
    const result = allocateFefo([batch("basi", "2026-10-02", 10), batch("segar", "2026-10-20", 3)], 5, TODAY);
    expect(result.expired).toEqual(["basi"]);
    expect(result.allocations).toHaveLength(1);
    expect(result.shortfall).toBe(2);
  });

  it("batch yang kedaluwarsa hari ini masih boleh keluar", () => {
    const result = allocateFefo([batch("hari-ini", TODAY, 2)], 2, TODAY);
    expect(result.expired).toEqual([]);
    expect(result.shortfall).toBe(0);
  });

  it("seri tanggal dipecah urutan kedatangan", () => {
    const sorted = sortFefo([
      batch("b", "2026-11-01", 1, "2026-09-02T00:00:00Z"),
      batch("a", "2026-11-01", 1, "2026-09-01T00:00:00Z"),
    ]);
    expect(sorted.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("menghitung biaya per batch dan membulatkan qty ke 3 desimal", () => {
    const result = allocateFefo(
      [batch("x", "2026-10-10", 0.1, undefined, 1000), batch("y", "2026-10-11", 0.2, undefined, 2000)],
      0.3,
      TODAY
    );
    expect(result.shortfall).toBe(0);
    expect(result.cost).toBe(500);
  });

  it("qty nol atau negatif tidak mengalokasikan apa pun", () => {
    expect(allocateFefo([batch("x", null, 5)], 0, TODAY).allocations).toEqual([]);
    expect(allocateFefo([batch("x", null, 5)], -1, TODAY).allocations).toEqual([]);
  });

  it("mengabaikan batch kosong", () => {
    const result = allocateFefo([batch("kosong", "2026-10-04", 0), batch("isi", "2026-10-09", 2)], 1, TODAY);
    expect(result.allocations.map((a) => a.batchId)).toEqual(["isi"]);
  });
});

describe("expiryState", () => {
  it("membedakan none, fresh, near, expired", () => {
    expect(expiryState({ expiryDate: null }, TODAY, 7)).toBe("none");
    expect(expiryState({ expiryDate: "2026-11-01" }, TODAY, 7)).toBe("fresh");
    expect(expiryState({ expiryDate: "2026-10-10" }, TODAY, 7)).toBe("near");
    expect(expiryState({ expiryDate: "2026-10-02" }, TODAY, 7)).toBe("expired");
  });
});

describe("defaultExpiryDate", () => {
  it("tanggal terima + shelf life", () => {
    expect(defaultExpiryDate("2026-10-03", 10)).toBe("2026-10-13");
    expect(defaultExpiryDate("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("null bila shelf life kosong atau nol", () => {
    expect(defaultExpiryDate("2026-10-03", null)).toBeNull();
    expect(defaultExpiryDate("2026-10-03", 0)).toBeNull();
  });
});

describe("summarizeExpiry", () => {
  it("menilai stok hampir dan sudah kedaluwarsa dengan biaya rata-rata", () => {
    const summary = summarizeExpiry(
      [
        { expiryDate: "2026-10-05", qtyRemaining: 2, valueCost: 1500 },
        { expiryDate: "2026-10-01", qtyRemaining: 3, valueCost: 1000 },
        { expiryDate: "2026-12-01", qtyRemaining: 9, valueCost: 1000 },
        { expiryDate: null, qtyRemaining: 9, valueCost: 1000 },
      ],
      TODAY,
      7
    );
    expect(summary).toEqual({
      nearBatches: 1,
      nearQty: 2,
      nearValue: 3000,
      expiredBatches: 1,
      expiredQty: 3,
      expiredValue: 3000,
    });
  });
});

describe("tanggal", () => {
  it("daysBetween dan todayJakarta", () => {
    expect(daysBetween("2026-10-03", "2026-10-01")).toBe(-2);
    expect(todayJakarta(new Date("2026-10-03T18:00:00Z"))).toBe("2026-10-04");
  });

  it("toDateOnly menerima Date dari driver pg dan string", () => {
    expect(toDateOnly(new Date(2026, 9, 13))).toBe("2026-10-13");
    expect(toDateOnly("2026-10-13T00:00:00.000Z")).toBe("2026-10-13");
    expect(toDateOnly("bukan tanggal")).toBeNull();
    expect(toDateOnly(null)).toBeNull();
  });
});
