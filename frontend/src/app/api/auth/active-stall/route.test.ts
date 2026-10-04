// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const STALL_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getApiUserScope: vi.fn(),
  getStallAccess: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireApiUser: mocks.requireApiUser,
}));
vi.mock("@/lib/api/scope", () => ({ getApiUserScope: mocks.getApiUserScope }));
vi.mock("@/lib/auth/stall-access", () => ({ getStallAccess: mocks.getStallAccess }));
vi.mock("@/lib/db", () => ({ queryOne: mocks.queryOne, query: vi.fn() }));

import { POST } from "./route";

const post = (warehouse_id: string | null) =>
  POST(
    new NextRequest("https://dashboard.test/api/auth/active-stall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouse_id }),
    })
  );
const cookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ id: "u1", role: "admin", full_name: "A", brand_id: null });
  mocks.getApiUserScope.mockResolvedValue(null);
  mocks.getStallAccess.mockResolvedValue({ allAccess: true, stalls: [] });
  mocks.queryOne.mockResolvedValue({ id: STALL_ID, name: "Stall A", code: "A" });
});

describe("POST /api/auth/active-stall", () => {
  it("menulis cookie nuhabit-active-stall dan menghapus cookie lama", async () => {
    const res = await post(STALL_ID);
    expect(res.status).toBe(200);
    expect(cookie(res, "nuhabit-active-stall")).toContain(`nuhabit-active-stall=${STALL_ID}`);
    expect(cookie(res, "arkiv-active-stall")).toMatch(/Max-Age=0/);
  });

  it("null menyimpan 'all' untuk user akses penuh", async () => {
    const res = await post(null);
    expect(cookie(res, "nuhabit-active-stall")).toContain("nuhabit-active-stall=all");
  });

  it("403 untuk stall di luar penempatan", async () => {
    mocks.requireApiUser.mockResolvedValue({ id: "u1", role: "pos", full_name: "A", brand_id: null });
    mocks.getStallAccess.mockResolvedValue({
      allAccess: false,
      stalls: [
        { id: "22222222-2222-4222-8222-222222222222", name: "B", code: "B", is_default: true },
        { id: "33333333-3333-4333-8333-333333333333", name: "C", code: "C", is_default: false },
      ],
    });
    const res = await post(STALL_ID);
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
