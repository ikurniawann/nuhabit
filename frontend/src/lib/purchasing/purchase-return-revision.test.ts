import { describe, expect, it } from "vitest";
import { evaluateReturnRevision, revisionNumber } from "./purchase-return-revision";

describe("evaluateReturnRevision", () => {
  it("hanya retur ditolak yang belum direvisi", () => {
    expect(evaluateReturnRevision({ status: "rejected", superseded_by: null })).toBeNull();
    expect(evaluateReturnRevision({ status: "pending_approval", superseded_by: null })).toMatchObject({ status: 409 });
    expect(evaluateReturnRevision({ status: "rejected", superseded_by: "r2" })).toMatchObject({
      status: 409,
      message: "Retur ini sudah pernah direvisi",
    });
    expect(evaluateReturnRevision(null)).toMatchObject({ status: 404 });
  });
});

describe("revisionNumber", () => {
  it("menambah akhiran revisi tanpa menumpuk", () => {
    expect(revisionNumber("RET-2026-004", 1)).toBe("RET-2026-004-R1");
    expect(revisionNumber("RET-2026-004-R1", 2)).toBe("RET-2026-004-R2");
  });
});
