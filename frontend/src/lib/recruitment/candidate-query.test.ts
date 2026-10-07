import { describe, expect, it } from "vitest";
import {
  buildCandidateListWhere,
  candidateCreateSchema,
  candidateUpdateSchema,
  pageWindow,
  parseCandidateListQuery,
} from "./candidate-query";

const BRAND = "11111111-1111-4111-8111-111111111111";

describe("parseCandidateListQuery", () => {
  it("default 20 per halaman, urut created_at, string kosong diabaikan", () => {
    const parsed = parseCandidateListQuery(new URLSearchParams("status=&search=&brand_id="));
    expect(parsed.success && parsed.data).toMatchObject({ page: 1, limit: 20, sort: "created_at", all: false });
  });

  it("menolak limit di atas 100 dan status asing", () => {
    expect(parseCandidateListQuery(new URLSearchParams("limit=1000")).success).toBe(false);
    expect(parseCandidateListQuery(new URLSearchParams("status=hacked")).success).toBe(false);
  });

  it("all=true mematikan paging", () => {
    const parsed = parseCandidateListQuery(new URLSearchParams("all=true&sort=updated_at"));
    expect(parsed.success && parsed.data.all).toBe(true);
  });
});

describe("buildCandidateListWhere", () => {
  it("tanpa filter: WHERE kosong", () => {
    expect(buildCandidateListWhere({})).toEqual({ where: "", params: [] });
  });

  it("parameter berurutan dan wildcard pencarian di-escape", () => {
    const { where, params } = buildCandidateListWhere({
      status: "screening",
      brand_id: BRAND,
      date_from: "2026-10-01",
      date_to: "2026-10-04",
      search: "50%_a",
    });
    expect(where).toBe(
      "WHERE c.status = $1 AND c.brand_id = $2 AND c.created_at >= $3::date AND c.created_at < $4::date + 1" +
        " AND (c.full_name ILIKE $5 OR c.email ILIKE $5 OR c.phone ILIKE $5)"
    );
    expect(params).toEqual(["screening", BRAND, "2026-10-01", "2026-10-04", "%50\\%\\_a%"]);
  });
});

describe("candidateCreateSchema", () => {
  const base = { full_name: "Sari Ayu", email: "sari@contoh.com", phone: "081234567890", domicile: "Bandung" };

  it("mengisi default dan menormalkan string kosong ke null", () => {
    const data = candidateCreateSchema.parse({ ...base, brand_id: "", notes: "" });
    expect(data).toMatchObject({ source: "walk_in", status: "applied", brand_id: null, notes: null, expected_salary: null });
  });

  it("hanya status awal applied/screening", () => {
    expect(candidateCreateSchema.safeParse({ ...base, status: "hired" }).success).toBe(false);
  });

  it("update parsial tidak menimpa source dengan default dan membuang status", () => {
    const data = candidateUpdateSchema.parse({ notes: "ok", status: "hired" });
    expect(data).toEqual({ notes: "ok" });
  });
});

describe("pageWindow", () => {
  it("maksimal 5 halaman dengan halaman aktif di tengah", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(2, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(6, 10)).toEqual([4, 5, 6, 7, 8]);
    expect(pageWindow(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });
});
