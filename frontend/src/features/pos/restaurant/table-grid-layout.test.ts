import { describe, expect, it } from "vitest";
import {
  chairLayout,
  drawnChairCount,
  groupTablesByArea,
  isWideTable,
  MAX_DRAWN_CHAIRS,
  seatedChairCount,
} from "./table-grid-layout";

describe("chairLayout", () => {
  it("kursi sesuai kapasitas, menyebar di sisi meja", () => {
    expect(chairLayout(2)).toEqual({ top: 0, bottom: 0, left: 1, right: 1 });
    expect(chairLayout(4)).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
    expect(chairLayout(6)).toEqual({ top: 2, bottom: 2, left: 1, right: 1 });
    expect(chairLayout(7)).toEqual({ top: 3, bottom: 2, left: 1, right: 1 });
    for (const cap of [1, 2, 3, 4, 5, 6, 8, 10]) {
      expect(drawnChairCount(chairLayout(cap))).toBe(cap);
    }
  });

  it("kapasitas besar dibatasi; nilai aneh jadi 1 kursi", () => {
    expect(drawnChairCount(chairLayout(20))).toBe(MAX_DRAWN_CHAIRS);
    expect(drawnChairCount(chairLayout(0))).toBe(1);
    expect(drawnChairCount(chairLayout(Number.NaN))).toBe(1);
  });

  it("meja ≥7 kursi dianggap panjang (2 kolom)", () => {
    expect(isWideTable(4)).toBe(false);
    expect(isWideTable(6)).toBe(false);
    expect(isWideTable(8)).toBe(true);
  });
});

describe("seatedChairCount", () => {
  it("terisi mengikuti jumlah tamu, dibatasi kursi yang digambar", () => {
    expect(seatedChairCount("occupied", 3, 6)).toBe(3);
    expect(seatedChairCount("billing", 9, 6)).toBe(6);
  });
  it("terisi tanpa data tamu → semua kursi; kosong/reservasi → 0", () => {
    expect(seatedChairCount("occupied", null, 4)).toBe(4);
    expect(seatedChairCount("available", 3, 4)).toBe(0);
    expect(seatedChairCount("reserved", 3, 4)).toBe(0);
  });
});

describe("groupTablesByArea", () => {
  it("urut area (tanpa area paling akhir) lalu nomor meja numerik", () => {
    const tables = [
      { id: "a", area: "VIP", n: "5-10" },
      { id: "b", area: "Indoor", n: "5-10" },
      { id: "c", area: "Indoor", n: "5-2" },
      { id: "d", area: null, n: "1" },
    ];
    const groups = groupTablesByArea(tables, (t) => t.n);
    expect(groups.map((g) => g.area)).toEqual(["Indoor", "VIP", ""]);
    expect(groups[0].tables.map((t) => t.id)).toEqual(["c", "b"]);
  });
});
