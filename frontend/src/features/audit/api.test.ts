import { describe, expect, it } from "vitest";
import { auditLogSearchParams } from "./api";

const base = {
  page: 1,
  actorId: "",
  entity: null,
  action: null,
  search: "",
  dateFrom: "",
  dateTo: "",
};

describe("auditLogSearchParams", () => {
  it("hanya halaman dan limit tanpa filter", () => {
    expect(auditLogSearchParams(base)).toBe("page=1&limit=30");
  });

  it("menyertakan filter yang terisi, kata kunci di-trim", () => {
    const qs = new URLSearchParams(
      auditLogSearchParams({
        ...base,
        page: 2,
        actorId: "u1",
        entity: "grn",
        action: "grn.post",
        search: "  PO-1 ",
        dateFrom: "2026-10-01",
      })
    );
    expect(Object.fromEntries(qs)).toEqual({
      page: "2",
      limit: "30",
      actor_id: "u1",
      entity: "grn",
      action: "grn.post",
      search: "PO-1",
      date_from: "2026-10-01",
    });
  });
});
