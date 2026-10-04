import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { parseUserListQuery } from "./users-list-query";

const parse = (qs: string) => parseUserListQuery(new URLSearchParams(qs));

describe("parseUserListQuery", () => {
  it("default: halaman 1, 20 baris, urut nama naik", () => {
    expect(parse("")).toEqual({
      search: undefined,
      departmentId: undefined,
      employmentStatus: undefined,
      isActive: undefined,
      isAccessApp: undefined,
      role: undefined,
      page: 1,
      limit: 20,
      sortBy: "full_name",
      sortOrder: "asc",
    });
  });

  it("memetakan filter dan flag boolean", () => {
    const q = parse(
      "search=budi&department_id=d1&is_active=false&is_access_app=true&role=hrd&page=2&limit=15"
    );
    expect(q).toMatchObject({
      search: "budi",
      departmentId: "d1",
      isActive: false,
      isAccessApp: true,
      role: "hrd",
      page: 2,
      limit: 15,
    });
  });

  it("parameter kosong diabaikan", () => {
    expect(parse("search=&role=").search).toBeUndefined();
  });

  it("membuang koma dan kurung dari kata kunci", () => {
    expect(parse("search=a,b(c)").search).toBe("a b c");
    expect(parse("search=,").search).toBeUndefined();
  });

  it.each([
    "sort_by=password_hash",
    "sort_order=sideways",
    "is_active=yes",
    "page=0",
    "limit=1000",
  ])("menolak %s dengan 400", (qs) => {
    try {
      parse(qs);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });
});
