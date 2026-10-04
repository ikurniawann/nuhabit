import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { createUpdateSet, createWhere, isUuid, parsePagination, slugify, splitTotalCount } from "./sql";

describe("createWhere", () => {
  it("menomori placeholder berurutan dan memakai ulang param yang sama", () => {
    const where = createWhere(["l.deleted_at IS NULL"]);
    where.add("l.company_id = ?", "c1");
    const me = where.param("u1");
    where.push(`(l.owner_user_id = ${me} OR l.created_by = ${me})`);
    expect(where.sql()).toBe("l.deleted_at IS NULL AND l.company_id = $1 AND (l.owner_user_id = $2 OR l.created_by = $2)");
    expect(where.params).toEqual(["c1", "u1"]);
  });

  it("mulai dari startIndex bila query sudah punya parameter", () => {
    const where = createWhere([], 3);
    where.add("d.company_id = ?", "c1");
    expect(where.sql()).toBe("d.company_id = $3");
  });
});

describe("createUpdateSet", () => {
  it("melewati undefined, string kosong jadi NULL bila diminta, id parameter terakhir", () => {
    const update = createUpdateSet();
    update.setAll({ name: "A", city: "", notes: undefined }, true);
    update.set("custom", "{}", "::jsonb");
    update.raw("reminder_sent_at = NULL");
    expect(update.build("id-1")).toEqual({
      sql: "updated_at = now(), name = $1, city = $2, custom = $3::jsonb, reminder_sent_at = NULL",
      values: ["A", null, "{}", "id-1"],
      idParam: "$4",
    });
  });

  it("menolak PATCH tanpa field", () => {
    const update = createUpdateSet();
    update.setAll({ name: undefined });
    expect(() => update.build("id-1")).toThrow(ApiError);
    expect(() => update.build("id-1")).toThrow("Tidak ada field yang diubah");
  });
});

describe("parsePagination", () => {
  it("default page 1 limit 20, limit dibatasi 100", () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parsePagination(new URLSearchParams("page=3&limit=500"))).toEqual({ page: 3, limit: 100, offset: 200 });
    expect(parsePagination(new URLSearchParams("page=-1&limit=abc"))).toEqual({ page: 1, limit: 20, offset: 0 });
  });
});

describe("splitTotalCount", () => {
  it("memisahkan total_count dari baris", () => {
    expect(splitTotalCount([{ id: "a", total_count: "7" }, { id: "b", total_count: "7" }])).toEqual({
      data: [{ id: "a" }, { id: "b" }],
      total: 7,
    });
    expect(splitTotalCount([])).toEqual({ data: [], total: 0 });
  });
});

describe("isUuid & slugify", () => {
  it("validasi uuid", () => {
    expect(isUuid("3f2c1e4a-1b2c-4d5e-8f90-1234567890ab")).toBe(true);
    expect(isUuid("bukan-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it("slug huruf kecil tanpa tanda hubung di tepi", () => {
    expect(slugify("  Paket Gathering & Outbound! ", 40)).toBe("paket-gathering-outbound");
    expect(slugify("Field Trip Sekolah", 5)).toBe("field");
  });
});
