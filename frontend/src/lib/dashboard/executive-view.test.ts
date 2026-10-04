import { describe, expect, it } from "vitest";
import { changePercent, compareWeeks, targetPercent } from "./executive-view";

describe("executive view", () => {
  it("persen perubahan & capaian target dibulatkan", () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(66, 100)).toBe(-34);
    expect(targetPercent(1_250_000, 1_000_000)).toBe(125);
  });

  it("minggu ini vs minggu lalu", () => {
    const tren = Array.from({ length: 14 }, (_, i) => ({ omzet: i < 7 ? 10 : 20 }));
    expect(compareWeeks(tren)).toEqual({ ini: 140, lalu: 70 });
  });
});
