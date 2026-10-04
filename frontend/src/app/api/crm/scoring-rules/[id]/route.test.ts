// PATCH/DELETE /api/crm/scoring-rules/[id]: gate → cek akses baris → validasi
// → update parsial. Respons galat seragam { success: false, error }.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/db", () => db);

const guards = vi.hoisted(() => ({ requireCrmScope: vi.fn() }));
vi.mock("@/lib/crm/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm/guards")>()),
  requireCrmScope: guards.requireCrmScope,
}));

import { DELETE, PATCH } from "./route";

const ID = "8d3f0f8e-6a52-4f7b-9d0c-1b2a3c4d5e6f";
const ctx = { params: Promise.resolve({ id: ID }) };
const admin = { id: "u1", full_name: "Admin", role: "admin", brand_id: null };

function patch(body: unknown) {
  return new Request(`http://localhost/api/crm/scoring-rules/${ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  guards.requireCrmScope.mockResolvedValue({ user: admin, scope: { companyId: "co-1" } });
});

describe("PATCH /api/crm/scoring-rules/[id]", () => {
  it("403 dari gate diteruskan apa adanya", async () => {
    guards.requireCrmScope.mockRejectedValue(ApiError.forbidden());
    const res = await PATCH(patch({ points: 5 }), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it("404 bila aturan milik company lain", async () => {
    db.queryOne.mockResolvedValueOnce({ company_id: "co-2" });
    const res = await PATCH(patch({ points: 5 }), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Aturan tidak ditemukan" });
  });

  it("400 Validation failed dengan details untuk nilai di luar batas", async () => {
    db.queryOne.mockResolvedValueOnce({ company_id: null });
    const res = await PATCH(patch({ points: 500 }), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: "Validation failed" });
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("update parsial hanya menyentuh field yang dikirim (tanpa default)", async () => {
    db.queryOne
      .mockResolvedValueOnce({ company_id: "co-1" })
      .mockResolvedValueOnce({ id: ID, name: "Lead hangat", points: 5, is_active: false });
    const res = await PATCH(patch({ is_active: false }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: ID, name: "Lead hangat", points: 5, is_active: false },
      message: "Aturan diperbarui",
    });
    const [sql, values] = db.queryOne.mock.calls[1];
    expect(sql).toContain("SET updated_at = now(), is_active = $1 WHERE id = $2");
    expect(values).toEqual([false, ID]);
  });
});

describe("DELETE /api/crm/scoring-rules/[id]", () => {
  it("204 setelah cek akses", async () => {
    db.queryOne.mockResolvedValueOnce({ company_id: null });
    const res = await DELETE(new Request("http://localhost") as unknown as NextRequest, ctx);
    expect(res.status).toBe(204);
    expect(db.query).toHaveBeenCalledWith("DELETE FROM crm.crm_scoring_rules WHERE id = $1", [ID]);
  });
});
