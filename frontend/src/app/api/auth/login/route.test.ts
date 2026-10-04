// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateCredentials: vi.fn(),
  createSession: vi.fn(),
  isLoginBlocked: vi.fn(),
  recordLoginFailure: vi.fn(),
  clearLoginFailures: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  authenticateCredentials: mocks.authenticateCredentials,
  createSession: mocks.createSession,
}));
vi.mock("@/lib/auth/login-throttle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/login-throttle")>()),
  isLoginBlocked: mocks.isLoginBlocked,
  recordLoginFailure: mocks.recordLoginFailure,
  clearLoginFailures: mocks.clearLoginFailures,
}));

import { POST } from "./route";

const login = (body: unknown) =>
  POST(
    new Request("https://dashboard.test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isLoginBlocked.mockResolvedValue(false);
  mocks.createSession.mockResolvedValue({ token: "tok-baru", expiresAt: new Date("2026-10-18T00:00:00Z") });
});

describe("POST /api/auth/login", () => {
  it("400 bila email atau password kosong", async () => {
    const res = await login({ email: "a@b.c" });
    expect(res.status).toBe(400);
    expect(mocks.authenticateCredentials).not.toHaveBeenCalled();
  });

  it("401 dan mencatat kegagalan bila kredensial salah", async () => {
    mocks.authenticateCredentials.mockResolvedValue({ user: null, error: { message: "Invalid login credentials" } });
    const res = await login({ email: "a@b.c", password: "salah" });
    expect(res.status).toBe(401);
    expect(mocks.recordLoginFailure).toHaveBeenCalledOnce();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sukses menulis cookie nuhabit_session dan menghapus cookie lama arkiv_session", async () => {
    mocks.authenticateCredentials.mockResolvedValue({ user: { id: "u1", email: "a@b.c" }, error: null });
    const res = await login({ email: "a@b.c", password: "benar" });
    expect(res.status).toBe(200);
    expect(mocks.clearLoginFailures).toHaveBeenCalledOnce();

    const cookies = res.headers.getSetCookie();
    const fresh = cookies.find((c) => c.startsWith("nuhabit_session="));
    expect(fresh).toContain("nuhabit_session=tok-baru");
    expect(fresh).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith("arkiv_session="))).toMatch(/Max-Age=0/);
    expect((await res.json()).data.user).toEqual({ id: "u1", email: "a@b.c" });
  });
});
