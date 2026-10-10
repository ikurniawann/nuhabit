// Verifikasi OTP: rem per-IP hanya menghitung percobaan kode sungguhan,
// probe bypass dev (tanpa kode) tidak memakan jatah.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route answers 503 while OTP is paused; these tests cover the enabled flow.
vi.stubEnv("NEXT_PUBLIC_OTP_ENABLED", "true");
import type { NextRequest } from "next/server";

const consumeOtp = vi.fn();

vi.mock("@/lib/db", () => ({ getPool: vi.fn(() => ({ query: vi.fn() })) }));
vi.mock("@/lib/member-portal/dev-bypass", () => ({ canBypassOtp: () => false }));
vi.mock("@/lib/member-portal/session", () => ({
  createMemberSession: vi.fn(),
  MEMBER_SESSION_COOKIE: "member_session",
  memberSessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/member-portal/otp-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/member-portal/otp-store")>()),
  consumeOtp: (...a: unknown[]) => consumeOtp(...a),
}));

async function post(body: unknown, ip = "203.0.113.20") {
  const { POST } = await import("./route");
  const res = await POST({ headers: new Headers({ "cf-connecting-ip": ip }), json: async () => body } as unknown as NextRequest);
  return res.status;
}

beforeEach(async () => {
  (await import("@/lib/public/rate-limit")).resetRateLimits();
  consumeOtp.mockReset().mockResolvedValue({ ok: false, error: "Kode salah", status: 400 });
});

describe("POST /api/member-portal/verify", () => {
  it("tebakan kode dari satu IP ke banyak nomor dihentikan (429)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push(await post({ phone: `0812000${String(i).padStart(5, "0")}`, code: "123456" }));
    expect(statuses.slice(0, 60).every((s) => s === 400)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(consumeOtp).toHaveBeenCalledTimes(60);
  });

  it("probe tanpa kode tidak memakan jatah per-IP", async () => {
    for (let i = 0; i < 100; i++) expect(await post({ phone: "081234567890" })).toBe(400);
    expect(await post({ phone: "081234567890", code: "123456" })).toBe(400);
    expect(consumeOtp).toHaveBeenCalledTimes(1);
  });
});
