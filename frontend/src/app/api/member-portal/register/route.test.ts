// Daftar mandiri langkah akhir: kode OTP dibuktikan DULU, baru status member
// diungkap — tanpa kode sah, nomor member tidak bisa dibedakan.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route answers 503 while OTP is paused; these tests cover the enabled flow.
vi.stubEnv("NEXT_PUBLIC_OTP_ENABLED", "true");
import type { NextRequest } from "next/server";

const consumeOtp = vi.fn();
const findMemberByPhone = vi.fn();

vi.mock("@/lib/db", () => ({
  withTransaction: async (fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) }),
}));
vi.mock("@/lib/member-portal/dev-bypass", () => ({ canBypassOtp: () => false }));
vi.mock("@/lib/member-portal/otp-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/member-portal/otp-store")>()),
  consumeOtp: (...a: unknown[]) => consumeOtp(...a),
  findMemberByPhone: (...a: unknown[]) => findMemberByPhone(...a),
}));

function req(code: string): NextRequest {
  return {
    headers: new Headers({ "cf-connecting-ip": "203.0.113.5" }),
    json: async () => ({ phone: "081234567890", code, name: "Ani Wijaya", wa_consent: false }),
  } as unknown as NextRequest;
}

async function post(code: string) {
  const { POST } = await import("./route");
  const res = await POST(req(code));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  (await import("@/lib/public/rate-limit")).resetRateLimits();
  consumeOtp.mockReset();
  findMemberByPhone.mockReset().mockResolvedValue({ id: "c-1", name: "Ani" });
});

describe("POST /api/member-portal/register", () => {
  it("kode salah untuk nomor member → jawaban kode salah, bukan 'sudah terdaftar'", async () => {
    consumeOtp.mockResolvedValue({ ok: false, error: "Kode salah", status: 400 });
    const { status, json } = await post("000000");
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: "Kode salah", field: "code" });
    expect(findMemberByPhone).not.toHaveBeenCalled();
  });

  it("kode sah untuk nomor member → 409 arahkan masuk", async () => {
    consumeOtp.mockResolvedValue({ ok: true });
    const { status, json } = await post("123456");
    expect(status).toBe(409);
    expect(json).toMatchObject({ field: "phone" });
  });
});
