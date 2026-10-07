// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { isUniqueViolation, parseBody, parseInput, requireUuid } from "./staff-route";

const schema = z.object({ reason: z.string().min(3, "Alasan wajib diisi"), amount: z.number() });

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("tidak melempar");
};

describe("parseInput", () => {
  it("lolos: mengembalikan data hasil parse", () => {
    expect(parseInput(schema, { reason: "salah input", amount: 2 })).toEqual({ reason: "salah input", amount: 2 });
  });

  it("gaya field: 400 menyebut kolom pertama yang salah", () => {
    const error = failure(() => parseInput(schema, { reason: "ok!", amount: "2" }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: "Data tidak valid: amount" });
  });

  it("gaya issue: memakai pesan kustom skema", () => {
    const error = failure(() => parseInput(schema, { reason: "", amount: 1 }, "issue"));
    expect(error.message).toBe("Alasan wajib diisi");
  });

  it("bukan objek sama sekali: pesan umum", () => {
    expect(failure(() => parseInput(schema, undefined)).message).toBe("Data tidak valid");
  });
});

describe("parseBody", () => {
  it("body bukan JSON diperlakukan kosong (400, bukan 500)", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "{oops" });
    await expect(parseBody(request, schema)).rejects.toMatchObject({ status: 400 });
  });
});

describe("requireUuid", () => {
  it("UUID sah dikembalikan apa adanya", () => {
    expect(requireUuid("6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11")).toBe("6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11");
  });

  it("kosong atau bukan UUID: 400 dengan pesan yang diberikan", () => {
    expect(failure(() => requireUuid(null))).toMatchObject({ status: 400, message: "ID tidak valid" });
    expect(failure(() => requireUuid("x", "ID coach tidak valid")).message).toBe("ID coach tidak valid");
  });
});

describe("isUniqueViolation", () => {
  it("hanya kode 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
