import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { parseSearchParams } from "./query-params";

const schema = z.object({ page: z.coerce.number().int().min(1).default(1), tipe: z.enum(["in", "out"]).optional() });

describe("parseSearchParams", () => {
  it("membuang nilai kosong (dan nilai di daftar ignore) sebelum validasi", () => {
    expect(parseSearchParams(new URLSearchParams("page=&tipe="), schema)).toEqual({ page: 1 });
    expect(parseSearchParams(new URLSearchParams("tipe=all"), schema, "x", ["", "all"])).toEqual({ page: 1 });
  });

  it("galat validasi jadi ApiError 400 berpesan", () => {
    try {
      parseSearchParams(new URLSearchParams("tipe=lain"), schema, "Filter tidak valid");
      throw new Error("tidak melempar");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toBe("Filter tidak valid");
    }
  });
});
