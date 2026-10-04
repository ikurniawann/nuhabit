import { describe, expect, it } from "vitest";
import {
  applyChannelMarkup,
  markupPercentOf,
  resolveChannelPrice,
  roundToStep,
  roundingLabel,
  type ChannelRule,
} from "./channel-pricing";

const gofood: ChannelRule = {
  code: "gofood",
  name: "GoFood",
  markupPercent: 20,
  roundingStep: 1000,
  roundingMode: "up",
  isActive: true,
};

describe("roundToStep", () => {
  it("ke atas / terdekat / ke bawah", () => {
    expect(roundToStep(21600, 1000, "up")).toBe(22000);
    expect(roundToStep(21600, 1000, "nearest")).toBe(22000);
    expect(roundToStep(21400, 1000, "nearest")).toBe(21000);
    expect(roundToStep(21600, 1000, "down")).toBe(21000);
    expect(roundToStep(21600, 500, "up")).toBe(22000);
    expect(roundToStep(21250, 500, "up")).toBe(21500);
    expect(roundToStep(21650, 1, "up")).toBe(21650);
  });

  it("galat float tidak menaikkan harga yang sudah bulat (50000 × 1,1)", () => {
    expect(50000 * 1.1).not.toBe(55000); // 55000.00000000001 di JS
    expect(roundToStep(50000 * 1.1, 1000, "up")).toBe(55000);
    expect(applyChannelMarkup(50000, { ...gofood, markupPercent: 10 })).toBe(55000);
  });

  it("nilai kosong/negatif = 0", () => {
    expect(roundToStep(0, 1000, "up")).toBe(0);
    expect(roundToStep(-5, 1000, "up")).toBe(0);
    expect(roundToStep(Number.NaN, 1000, "up")).toBe(0);
  });
});

describe("applyChannelMarkup", () => {
  it("markup 20% dibulatkan ke atas per Rp1.000 → harga tidak keriting", () => {
    expect(applyChannelMarkup(25000, gofood)).toBe(30000);
    expect(applyChannelMarkup(18000, gofood)).toBe(22000);
    expect(applyChannelMarkup(15000, gofood)).toBe(18000);
    // tambahan varian/add-on ikut aturan yang sama
    expect(applyChannelMarkup(5000, gofood)).toBe(6000);
    expect(applyChannelMarkup(3000, gofood)).toBe(4000);
  });

  it("channel nonaktif = harga dasar; add-on gratis tetap 0", () => {
    expect(applyChannelMarkup(25000, { ...gofood, isActive: false })).toBe(25000);
    expect(applyChannelMarkup(0, gofood)).toBe(0);
  });

  it("pembulatan ke bawah tidak pernah di bawah harga dasar", () => {
    expect(applyChannelMarkup(25500, { ...gofood, markupPercent: 0, roundingMode: "down" })).toBe(25500);
    expect(applyChannelMarkup(25000, { ...gofood, markupPercent: 3, roundingMode: "down" })).toBe(25000);
  });
});

describe("resolveChannelPrice", () => {
  it("tanpa harga manual → otomatis", () => {
    expect(resolveChannelPrice(25000, gofood, null)).toEqual({ base: 25000, auto: 30000, final: 30000, isManual: false });
  });

  it("harga manual menang atas otomatis", () => {
    expect(resolveChannelPrice(25000, gofood, 29000)).toEqual({ base: 25000, auto: 30000, final: 29000, isManual: true });
  });

  it("channel nonaktif mengabaikan harga manual", () => {
    expect(resolveChannelPrice(25000, { ...gofood, isActive: false }, 29000)).toEqual({
      base: 25000,
      auto: 25000,
      final: 25000,
      isManual: false,
    });
  });

  it("harga manual 0/NaN dianggap tidak ada", () => {
    expect(resolveChannelPrice(25000, gofood, 0).isManual).toBe(false);
    expect(resolveChannelPrice(25000, gofood, Number.NaN).isManual).toBe(false);
  });
});

describe("util tampilan", () => {
  it("selisih persen & label pembulatan", () => {
    expect(markupPercentOf(25000, 30000)).toBe(20);
    expect(markupPercentOf(18000, 22000)).toBe(22.2);
    expect(markupPercentOf(0, 1000)).toBeNull();
    expect(roundingLabel(1000, "up")).toBe("Kelipatan Rp1.000 ke atas");
    expect(roundingLabel(1, "up")).toBe("Tanpa pembulatan");
  });
});
