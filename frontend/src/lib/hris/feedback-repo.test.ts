import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn(), createServerPgClient: vi.fn() }));

const { paginationMeta, parsePagination } = await import("./feedback-repo");

describe("parsePagination", () => {
  it("default per endpoint dan rentang range()", () => {
    expect(parsePagination(new URLSearchParams(), 20)).toEqual({ page: 1, limit: 20, from: 0, to: 19 });
    expect(parsePagination(new URLSearchParams("page=3&limit=10"), 20)).toEqual({ page: 3, limit: 10, from: 20, to: 29 });
  });
  it("nilai rusak jatuh ke default", () => {
    expect(parsePagination(new URLSearchParams("page=-2&limit=x"), 50)).toMatchObject({ page: 1, limit: 50 });
  });
  it("totalPages dibulatkan ke atas", () => {
    expect(paginationMeta(parsePagination(new URLSearchParams("limit=20"), 20), 41)).toEqual({
      page: 1,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });
});
