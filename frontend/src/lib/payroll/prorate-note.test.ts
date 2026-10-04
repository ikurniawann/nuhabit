import { describe, expect, it } from "vitest";
import {
  parseProrateFactor,
  prorateBreakdown,
  prorateNote,
} from "@/lib/payroll/prorate-note";

describe("parseProrateFactor", () => {
  it("returns null for full period (1, '1.000000')", () => {
    expect(parseProrateFactor(1)).toBeNull();
    expect(parseProrateFactor("1.000000")).toBeNull();
  });

  it("returns null for missing/invalid values", () => {
    expect(parseProrateFactor(null)).toBeNull();
    expect(parseProrateFactor(undefined)).toBeNull();
    expect(parseProrateFactor("abc")).toBeNull();
    expect(parseProrateFactor(0)).toBeNull();
  });

  it("parses pg numeric string partial factor", () => {
    expect(parseProrateFactor("0.516129")).toBeCloseTo(0.516129);
  });

  it("treats near-1 rounding artifacts as full period", () => {
    expect(parseProrateFactor("0.999900")).toBeNull();
  });
});

describe("prorateBreakdown", () => {
  it("returns null for full period", () => {
    expect(
      prorateBreakdown({ factor: "1.000000", fullBase: "4750000.00", paidBase: "4750000.00" })
    ).toBeNull();
  });

  it("uses stored full base salary when available (pg numeric strings)", () => {
    const b = prorateBreakdown({
      factor: "0.516129",
      fullBase: "4750000.00",
      paidBase: "2451613.00",
    });
    expect(b).not.toBeNull();
    expect(b!.fullBase).toBe(4750000);
    expect(b!.paidPct).toBe("51,6");
    expect(b!.cutPct).toBe("48,4");
  });

  it("derives full base from paid/factor when snapshot column is null (old rows)", () => {
    const b = prorateBreakdown({
      factor: "0.516129",
      fullBase: null,
      paidBase: "2451613.00",
    });
    expect(b).not.toBeNull();
    expect(b!.fullBase).toBe(4750000);
  });

  it("paid + cut percentages complement to 100", () => {
    const b = prorateBreakdown({ factor: 0.5, fullBase: 5000000, paidBase: 2500000 });
    expect(b!.paidPct).toBe("50");
    expect(b!.cutPct).toBe("50");
  });
});

describe("prorateNote", () => {
  it("returns null for full period", () => {
    expect(prorateNote({ factor: "1.000000", fullBase: null, paidBase: 0 })).toBeNull();
  });

  it("states full base, paid pct, and cut pct so the slip is unambiguous", () => {
    expect(
      prorateNote({ factor: "0.516129", fullBase: "4750000.00", paidBase: "2451613.00" })
    ).toBe(
      "Prorata dari gaji pokok penuh Rp4.750.000 — dibayar 51,6%, dipotong 48,4% (cakupan kontrak tidak satu periode penuh)"
    );
  });
});
