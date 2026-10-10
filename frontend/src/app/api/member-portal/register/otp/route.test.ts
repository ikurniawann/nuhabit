// Daftar mandiri langkah 1: jawaban sama untuk nomor member & bukan member
// (tidak membocorkan keanggotaan), plus rem per-IP.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route answers 503 while OTP is paused; these tests cover the enabled flow.
vi.stubEnv("NEXT_PUBLIC_OTP_ENABLED", "true");
import type { NextRequest } from "next/server";

const issueOtp = vi.fn();
const findMemberByPhone = vi.fn();

vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/member-portal/dev-bypass", () => ({ isDevBypassActive: () => false }));
vi.mock("@/lib/member-portal/otp-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/member-portal/otp-store")>()),
  issueOtp: (...a: unknown[]) => issueOtp(...a),
  findMemberByPhone: (...a: unknown[]) => findMemberByPhone(...a),
}));

function req(phone: string, ip: string): NextRequest {
  return {
    headers: new Headers({ "cf-connecting-ip": ip }),
    json: async () => ({ phone }),
  } as unknown as NextRequest;
}

async function post(phone: string, ip = "203.0.113.1") {
  const { POST } = await import("./route");
  const res = await POST(req(phone, ip));
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  (await import("@/lib/public/rate-limit")).resetRateLimits();
  issueOtp.mockReset().mockResolvedValue({ ok: true, waDelivered: true });
  findMemberByPhone.mockReset();
});

describe("POST /api/member-portal/register/otp", () => {
  it("nomor member dan bukan member mendapat jawaban identik", async () => {
    findMemberByPhone.mockResolvedValue({ id: "c-1", name: "Ani" });
    const member = await post("081234567890");
    findMemberByPhone.mockResolvedValue(null);
    const stranger = await post("081298765432");
    expect(member).toEqual(stranger);
    expect(member).toEqual({ status: 200, json: { success: true, wa_delivered: true, dev_bypass: false } });
  });

  it("rem per-IP: permintaan berlebih dari satu IP → 429, IP lain tetap jalan", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post(`0812000000${String(i).padStart(2, "0")}`, "198.51.100.9")).status;
    expect(last).toBe(429);
    expect((await post("081234567890", "198.51.100.10")).status).toBe(200);
  });
});
