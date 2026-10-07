// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), queryOne: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getSessionUserFromCookies: mocks.session }));
vi.mock("@/lib/db", () => ({ queryOne: mocks.queryOne }));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/auth/me", () => {
  it("401 tanpa sesi", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Not authenticated" });
  });

  it("401 bila sesi tidak punya profil configuration.users", async () => {
    mocks.session.mockResolvedValue({ id: "u1", email: "a@b.c" });
    mocks.queryOne.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("mengembalikan profil dengan email dari sesi", async () => {
    mocks.session.mockResolvedValue({ id: "u1", email: "a@b.c" });
    mocks.queryOne.mockResolvedValue({ id: "u1", full_name: "Sari", role: "admin", brand_id: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "u1", full_name: "Sari", role: "admin", brand_id: null, email: "a@b.c" },
    });
    expect(mocks.queryOne.mock.calls[0][1]).toEqual(["u1"]);
  });

  it("galat DB jadi 500 generik", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.session.mockResolvedValue({ id: "u1", email: "a@b.c" });
    mocks.queryOne.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Terjadi kesalahan server");
  });
});
