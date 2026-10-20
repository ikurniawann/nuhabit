import { describe, expect, it } from "vitest";
import { memberApiQuery, memberParamsToSearch, pageCount, parseMemberParams, toggleFlag } from "./list-params";

describe("member list params", () => {
  it("reads known filters and ignores the rest", () => {
    const params = parseMemberParams(new URLSearchParams("q=+budi+&expiring=1&inactive=0&page=3&foo=bar&branch_id=b1"));
    expect(params).toEqual({ q: "budi", branch_id: "b1", flags: ["expiring"], page: 3 });
  });

  it("falls back to page 1 for bad pages", () => {
    expect(parseMemberParams(new URLSearchParams("page=-2")).page).toBe(1);
    expect(parseMemberParams(new URLSearchParams("page=abc")).page).toBe(1);
  });

  it("round-trips through the URL in a stable order", () => {
    const search = "q=sari&branch_id=b1&active_pass=1&has_credits=1&page=2";
    const params = parseMemberParams(new URLSearchParams("page=2&has_credits=1&q=sari&active_pass=1&branch_id=b1"));
    expect(memberParamsToSearch(params)).toBe(search);
    expect(memberParamsToSearch(parseMemberParams(new URLSearchParams()))).toBe("");
  });

  it("adds the page size for the API", () => {
    expect(memberApiQuery({ q: "", branch_id: "", flags: [], page: 1 })).toBe("page_size=25");
  });

  it("toggles a filter and resets the page", () => {
    const on = toggleFlag({ q: "", branch_id: "", flags: [], page: 4 }, "inactive");
    expect(on).toEqual({ q: "", branch_id: "", flags: ["inactive"], page: 1 });
    expect(toggleFlag(on, "inactive").flags).toEqual([]);
  });

  it("counts pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
  });
});
