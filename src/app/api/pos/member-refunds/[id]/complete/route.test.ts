// Refund Completed mengubah saldo member → PIN supervisor dengan batas percobaan (429 saat terkunci).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const approve = vi.fn();
const tx = vi.fn();
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
}));
vi.mock("@/lib/db", () => ({
  queryOne: vi.fn(async () => ({ full_name: "Kasir A" })),
  withTransaction: (...a: unknown[]) => tx(...a),
}));
vi.mock("@/lib/pos/supervisor-pin-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/supervisor-pin-server")>()),
  approveWithSupervisorPin: (...a: unknown[]) => approve(...a),
}));

const ID = "11111111-2222-4333-8444-555555555555";
async function post(body: unknown, id = ID) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest, { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  approve.mockReset();
  tx.mockReset();
});

describe("POST /api/pos/member-refunds/[id]/complete", () => {
  it("ID tidak valid / PIN kosong → 400 tanpa cek PIN", async () => {
    expect((await post({ supervisor_pin: "1234" }, "bukan-uuid")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(approve).not.toHaveBeenCalled();
  });

  it("PIN salah → 403; kasir terkunci → 429 dengan sisa menit, saldo tidak disentuh", async () => {
    approve.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    expect(await post({ supervisor_pin: "0000" })).toMatchObject({ status: 403, json: { error: "PIN supervisor tidak valid" } });
    approve.mockResolvedValueOnce({ ok: false, reason: "locked", retryMinutes: 12 });
    const locked = await post({ supervisor_pin: "0000" });
    expect(locked.status).toBe(429);
    expect(String(locked.json.error)).toContain("12 menit");
    expect(approve).toHaveBeenCalledWith({ callerId: "kasir-1", pin: "0000" });
    expect(tx).not.toHaveBeenCalled();
  });
});
