import { describe, expect, it } from "vitest";
import { displayActorName, summarizeVoidRows } from "./void-report";

describe("summarizeVoidRows", () => {
  it("counts voids and sums amounts", () => {
    expect(
      summarizeVoidRows([
        { total_amount: 50_000 },
        { total_amount: 25_000 },
      ])
    ).toEqual({ voids: 2, amount: 75_000 });
  });
});

describe("displayActorName", () => {
  it("falls back when the user name is missing", () => {
    expect(displayActorName(null, "Kasir")).toBe("Kasir");
    expect(displayActorName("  Budi  ")).toBe("Budi");
  });
});
