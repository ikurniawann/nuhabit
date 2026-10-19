import { describe, expect, it } from "vitest";
import { diffAudit } from "./diff";

describe("diffAudit", () => {
  it("hanya field yang berubah", () => {
    expect(diffAudit({ qty: 5, note: "a", same: 1 }, { qty: 3, note: "a", same: 1, extra: true })).toEqual([
      { field: "extra", before: null, after: true },
      { field: "qty", before: 5, after: 3 },
    ]);
    expect(diffAudit(null, { status: "VOID" })).toEqual([{ field: "status", before: null, after: "VOID" }]);
  });
});
