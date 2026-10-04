import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { apiErrorResponse, apiHandler } from "./handler";

const body = async (res: Response) => ({ status: res.status, json: await res.json() });

describe("apiErrorResponse", () => {
  it("ApiError memakai status dan pesannya", async () => {
    expect(await body(apiErrorResponse(ApiError.notFound("Order tidak ditemukan")))).toEqual({
      status: 404,
      json: { success: false, error: "Order tidak ditemukan" },
    });
  });

  it("unique violation Postgres jadi 409 berpesan ramah", async () => {
    const res = await body(apiErrorResponse({ code: "23505", message: "duplicate key value violates" }));
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ success: false, error: "Data sudah ada di sistem" });
  });

  it("galat lain jadi 500 tanpa membocorkan pesan internal", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await body(apiErrorResponse(new Error("connection refused 10.0.0.5")));
    expect(res).toEqual({ status: 500, json: { success: false, error: "Terjadi kesalahan server" } });
    spy.mockRestore();
  });
});

describe("apiHandler", () => {
  it("meneruskan respons sukses dan menangkap ApiError", async () => {
    const ok = apiHandler(async () => Response.json({ success: true }));
    expect((await ok()).status).toBe(200);
    const fail = apiHandler(async () => {
      throw ApiError.forbidden();
    });
    expect((await fail()).status).toBe(403);
  });
});
