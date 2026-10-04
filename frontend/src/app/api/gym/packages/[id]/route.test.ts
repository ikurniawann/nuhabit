// @vitest-environment node
// /api/gym/packages/[id]: gerbang menu, validasi ID/body, dan galat bisnis
// lewat apiHandler (bentuk { success: false, error } dengan status 4xx).
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireIamMenuPrefix: vi.fn() }));
const query = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, requireIamMenuPrefix: auth.requireIamMenuPrefix };
});
vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));

import { ApiError } from "@/lib/api/auth";
import { DELETE, PATCH } from "./route";

const ID = "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const request = (body?: unknown) =>
  new Request("http://localhost/api/gym/packages/x", {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireIamMenuPrefix.mockResolvedValue({ id: "staff-1", full_name: "Staf", role: "admin", brand_id: null });
});

describe("PATCH /api/gym/packages/[id]", () => {
  it("tanpa akses menu: 403 dari guard, DB tidak disentuh", async () => {
    auth.requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden("Insufficient permissions"));
    const res = await PATCH(request({ status: "archived" }), ctx());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
    expect(query).not.toHaveBeenCalled();
  });

  it("ID bukan UUID: 400 'ID tidak valid'", async () => {
    const res = await PATCH(request({ status: "archived" }), ctx("abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ID tidak valid");
  });

  it("status di luar daftar: 400", async () => {
    const res = await PATCH(request({ status: "deleted" }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it("berhasil: { success: true, data } dari baris yang diperbarui", async () => {
    query.mockResolvedValue({ rows: [{ id: ID, status: "archived" }] });
    const res = await PATCH(request({ status: "archived" }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { id: ID, status: "archived" } });
    expect(query.mock.calls[0][1]).toEqual([ID, "archived"]);
  });

  it("paket tidak ada: 404", async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await PATCH(request({ status: "active" }), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Paket tidak ditemukan");
  });
});

describe("DELETE /api/gym/packages/[id]", () => {
  it("paket sudah pernah dibeli: 409 dan tidak dihapus", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{}], rowCount: 1 });
    const res = await DELETE(request(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Arsipkan saja/);
  });

  it("paket tanpa riwayat: terhapus", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: ID }] });
    const res = await DELETE(request(), ctx());
    expect(await res.json()).toEqual({ success: true, data: { id: ID, deleted: true } });
  });

  it("galat DB tak terduga: 500 dengan pesan aman", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValue(new Error("connection reset"));
    const res = await DELETE(request(), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Terjadi kesalahan server");
  });
});
