import { describe, expect, it } from "vitest";

import { getActiveSplitSummary } from "./split-summary";

describe("getActiveSplitSummary", () => {
  it("returns null when there are no splits", () => {
    expect(getActiveSplitSummary(undefined)).toBeNull();
    expect(getActiveSplitSummary([])).toBeNull();
  });

  it("ignores cancelled splits", () => {
    expect(
      getActiveSplitSummary([
        { status: "cancelled" },
        { status: "pending" },
        { status: "paid" },
      ])
    ).toEqual({ total: 2, paid: 1, pending: 1 });
  });

  it("counts all non-cancelled as total", () => {
    expect(
      getActiveSplitSummary([
        { status: "pending" },
        { status: "pending" },
        { status: "paid" },
      ])
    ).toEqual({ total: 3, paid: 1, pending: 2 });
  });
});
