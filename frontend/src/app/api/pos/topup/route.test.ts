// Top-up FOC = saldo gratis → PIN supervisor ber-batas percobaan (kasir terkunci → 429).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const approve = vi.fn();
const venue = vi.fn();
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/crm/loyalty-features-server", () => ({ rejectIfArkCoinDisabled: async () => null }));
vi.mock("@/lib/pos/topup-venue", () => ({ resolveTopupVenue: (...a: unknown[]) => venue(...a) }));
vi.mock("@/lib/pos/supervisor-pin-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/supervisor-pin-server")>()),
  approveWithSupervisorPin: (...a: unknown[]) => approve(...a),
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  approve.mockReset();
  venue.mockReset();
});

describe("POST /api/pos/topup (FOC)", () => {
  it("FOC tanpa PIN → 400", async () => {
    expect(await post({ customer_id: "c1", amount: 50000, payment_method: "foc" })).toMatchObject({
      status: 400,
      json: { error: "Topup FOC membutuhkan PIN supervisor" },
    });
  });

  it("PIN salah → 403; terkunci → 429; saldo tidak diproses", async () => {
    approve.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    expect((await post({ customer_id: "c1", amount: 50000, payment_method: "foc", supervisor_pin: "1" })).status).toBe(403);
    approve.mockResolvedValueOnce({ ok: false, reason: "locked", retryMinutes: 15 });
    const locked = await post({ customer_id: "c1", amount: 50000, payment_method: "foc", supervisor_pin: "1" });
    expect(locked.status).toBe(429);
    expect(approve).toHaveBeenLastCalledWith({ callerId: "kasir-1", pin: "1" });
    expect(venue).not.toHaveBeenCalled();
  });
});
