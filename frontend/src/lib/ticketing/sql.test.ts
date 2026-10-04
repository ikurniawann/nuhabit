import { describe, expect, test } from "vitest";
import { ApiError } from "@/lib/api/auth";
import {
  conflictOnDuplicate,
  pageMeta,
  patchAssignments,
  readPage,
  splitTotalCount,
  toNumberOrNull,
} from "./sql";

describe("patchAssignments", () => {
  test("melewati kolom undefined, placeholder mulai setelah offset", () => {
    expect(patchAssignments({ name: "A", label: undefined, is_active: false }, 3)).toEqual({
      assignments: ["name = $4", "is_active = $5"],
      values: ["A", false],
    });
  });

  test("null tetap ditulis (mengosongkan kolom)", () => {
    expect(patchAssignments({ capacity: null })).toEqual({
      assignments: ["capacity = $1"],
      values: [null],
    });
  });

  test("patch kosong → tanpa assignment", () => {
    expect(patchAssignments({ a: undefined })).toEqual({ assignments: [], values: [] });
  });
});

describe("conflictOnDuplicate", () => {
  test("23505 jadi ApiError 409 berpesan spesifik", async () => {
    const err = await conflictOnDuplicate(
      Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
      "Label sudah dipakai"
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("Label sudah dipakai");
  });

  test("galat lain diteruskan apa adanya", async () => {
    const original = Object.assign(new Error("fk"), { code: "23503" });
    await expect(conflictOnDuplicate(Promise.reject(original), "x")).rejects.toBe(original);
  });

  test("hasil sukses diteruskan", async () => {
    await expect(conflictOnDuplicate(Promise.resolve(7), "x")).resolves.toBe(7);
  });
});

describe("splitTotalCount", () => {
  test("memisahkan total_count dari baris", () => {
    expect(
      splitTotalCount([
        { id: "a", total_count: "12" },
        { id: "b", total_count: "12" },
      ])
    ).toEqual({ total: 12, items: [{ id: "a" }, { id: "b" }] });
  });

  test("halaman kosong → total 0", () => {
    expect(splitTotalCount([])).toEqual({ total: 0, items: [] });
  });
});

describe("readPage / pageMeta", () => {
  test("default page 1 limit 20; limit dibatasi maxLimit", () => {
    expect(readPage(new URLSearchParams(""), 50)).toEqual({ page: 1, limit: 20 });
    expect(readPage(new URLSearchParams("page=3&limit=500"), 50)).toEqual({ page: 3, limit: 50 });
    expect(readPage(new URLSearchParams("page=-2&limit=abc"), 50)).toEqual({ page: 1, limit: 20 });
  });

  test("totalPages dibulatkan ke atas", () => {
    expect(pageMeta(2, 20, 41)).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
  });
});

test("toNumberOrNull", () => {
  expect(toNumberOrNull("12500.50")).toBe(12500.5);
  expect(toNumberOrNull(null)).toBeNull();
});
