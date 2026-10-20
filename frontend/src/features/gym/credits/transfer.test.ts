import { describe, expect, it } from "vitest";
import { transferPicks } from "./transfer";

const lots = [
  { id: "a", remaining: 3 },
  { id: "b", remaining: 5 },
];

describe("transferPicks", () => {
  it("keeps the lots with an amount, in lot order", () => {
    expect(transferPicks(lots, { b: "2", a: "1" })).toEqual({
      ok: true,
      lots: [
        { lot_id: "a", credits: 1 },
        { lot_id: "b", credits: 2 },
      ],
    });
  });

  it("skips empty and zero fields", () => {
    expect(transferPicks(lots, { a: "", b: "0" })).toEqual({ ok: true, lots: [] });
  });

  it("refuses more than a lot holds and fractions", () => {
    expect(transferPicks(lots, { a: "4" })).toEqual({ ok: false, error: "Sisa lot hanya 3 kredit." });
    expect(transferPicks(lots, { b: "1.5" }).ok).toBe(false);
  });
});
