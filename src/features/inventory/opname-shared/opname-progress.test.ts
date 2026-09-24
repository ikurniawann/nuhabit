import { describe, expect, it } from "vitest";
import { lineStatus, matchesFilter, nextUncountedKey, summarize } from "./opname-progress";

const L = (key: string, qtyInput: string, variance: number | null) => ({ key, qtyInput, variance });

describe("opname checklist", () => {
  it("status baris: kosong = belum, selisih 0 = sama, selain itu = selisih", () => {
    expect(lineStatus(L("a", "", null))).toBe("belum");
    expect(lineStatus(L("a", "  ", null))).toBe("belum");
    expect(lineStatus(L("a", "10", 0))).toBe("sama");
    expect(lineStatus(L("a", "12", 2))).toBe("selisih");
    expect(lineStatus(L("a", "8", -2))).toBe("selisih");
  });
  it("filter Belum/Sudah/Selisih", () => {
    const belum = L("a", "", null), sama = L("b", "1", 0), beda = L("c", "3", 2);
    expect([belum, sama, beda].filter((l) => matchesFilter(l, "belum")).map((l) => l.key)).toEqual(["a"]);
    expect([belum, sama, beda].filter((l) => matchesFilter(l, "sudah")).map((l) => l.key)).toEqual(["b", "c"]);
    expect([belum, sama, beda].filter((l) => matchesFilter(l, "selisih")).map((l) => l.key)).toEqual(["c"]);
    expect([belum, sama, beda].filter((l) => matchesFilter(l, "semua"))).toHaveLength(3);
  });
  it("ringkasan & persen", () => {
    expect(summarize([L("a", "", null), L("b", "1", 0), L("c", "3", 2), L("d", "3", 0)])).toEqual({ total: 4, sudah: 3, belum: 1, selisih: 1, persen: 75 });
    expect(summarize([])).toEqual({ total: 0, sudah: 0, belum: 0, selisih: 0, persen: 0 });
  });
  it("baris berikutnya yang belum dihitung, melingkar, tidak kembali ke diri sendiri", () => {
    const lines = [L("a", "1", 0), L("b", "", null), L("c", "", null)];
    expect(nextUncountedKey(lines, null)).toBe("b");
    expect(nextUncountedKey(lines, "b")).toBe("c");
    expect(nextUncountedKey(lines, "c")).toBe("b");
    expect(nextUncountedKey([L("a", "1", 0)], "a")).toBeNull();
  });
});
