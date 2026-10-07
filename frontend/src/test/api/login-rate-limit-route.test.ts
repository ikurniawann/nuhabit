/**
 * Route-level: brute force login benar-benar diblokir oleh handler
 * /api/auth/login (audit 2026-09-17). Throttle di-mock dengan tiruan berbasis
 * hitungan supaya yang diuji adalah PERKABELAN route (cek sebelum auth,
 * catat saat gagal, bersihkan saat sukses) tanpa menyentuh database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_MAX_PER_ACCOUNT } from "@/lib/auth/login-throttle";

const authenticateCredentials = vi.fn();
const failures = new Map<string, number>();
let cleared: string[] = [];

vi.mock("@/lib/auth/session", () => ({
  authenticateCredentials: (...args: unknown[]) => authenticateCredentials(...args),
  createSession: vi.fn(async () => ({ token: "t", expiresAt: new Date(Date.now() + 3600_000) })),
  setSessionCookie: vi.fn(),
}));

vi.mock("@/lib/auth/login-throttle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/login-throttle")>();
  return {
    ...actual,
    isLoginBlocked: async (account: string) =>
      (failures.get(account) ?? 0) >= actual.LOGIN_MAX_PER_ACCOUNT,
    recordLoginFailure: async (account: string) => {
      failures.set(account, (failures.get(account) ?? 0) + 1);
    },
    clearLoginFailures: async (account: string) => {
      cleared.push(account);
      failures.delete(account);
    },
  };
});

const loginRequest = (email: string, password = "salah") =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.5" },
    body: JSON.stringify({ email, password }),
  });

beforeEach(() => {
  failures.clear();
  cleared = [];
  authenticateCredentials.mockReset();
  authenticateCredentials.mockResolvedValue({ user: null, error: { message: "Invalid login credentials" } });
});

describe("POST /api/auth/login — rate limit", () => {
  it(`${LOGIN_MAX_PER_ACCOUNT} percobaan gagal masih 401, berikutnya 429`, async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < LOGIN_MAX_PER_ACCOUNT; i++) {
      const res = await POST(loginRequest("korban@bcdcoffee.id"));
      expect(res.status, `percobaan ke-${i + 1}`).toBe(401);
    }
    const blocked = await POST(loginRequest("korban@bcdcoffee.id"));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/terlalu banyak/i);
  });

  it("saat diblokir, autentikasi TIDAK dipanggil lagi", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < LOGIN_MAX_PER_ACCOUNT; i++) await POST(loginRequest("a@bcdcoffee.id"));
    const before = authenticateCredentials.mock.calls.length;
    await POST(loginRequest("a@bcdcoffee.id"));
    expect(authenticateCredentials.mock.calls.length).toBe(before);
  });

  it("akun lain tidak ikut terkunci (batas per-akun)", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i <= LOGIN_MAX_PER_ACCOUNT; i++) await POST(loginRequest("a@bcdcoffee.id"));
    expect((await POST(loginRequest("b@bcdcoffee.id"))).status).toBe(401);
  });

  it("email disamakan huruf kecil — A@x dan a@x dihitung satu akun", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < LOGIN_MAX_PER_ACCOUNT; i++) await POST(loginRequest("Korban@Bcdcoffee.ID"));
    expect((await POST(loginRequest("korban@bcdcoffee.id"))).status).toBe(429);
  });

  it("login sukses membersihkan hitungan gagal akun itu", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    await POST(loginRequest("c@bcdcoffee.id"));
    expect(failures.get("c@bcdcoffee.id")).toBe(1);
    authenticateCredentials.mockResolvedValue({ user: { id: "u1", email: "c@bcdcoffee.id" }, error: null });
    const ok = await POST(loginRequest("c@bcdcoffee.id", "benar"));
    expect(ok.status).toBe(200);
    expect(cleared).toContain("c@bcdcoffee.id");
    expect(failures.has("c@bcdcoffee.id")).toBe(false);
  });
});
