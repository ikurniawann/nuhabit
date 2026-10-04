// Dompet admin — POST /api/wallet/members/[id]/adjust lewat apiHandler:
// gerbang IAM, validasi UUID & body, WalletError membawa status sendiri.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args),
}));

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), withTransaction: vi.fn(), query: vi.fn(), queryOne: vi.fn() }));

const applyAdjustment = vi.fn();
vi.mock("@/lib/wallet/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wallet/server")>()),
  applyAdjustment: (...args: unknown[]) => applyAdjustment(...args),
}));

const { ApiError } = await import("@/lib/api/auth");
const { WalletError } = await import("@/lib/wallet/server");
const { POST } = await import("./route");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const call = (id: string, body: unknown) =>
  POST(
    new Request(`http://test/api/wallet/members/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) }
  );

describe("POST /api/wallet/members/[id]/adjust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIamMenuPrefix.mockResolvedValue({ id: "staff-1", full_name: "Rina", role: "admin", brand_id: null });
  });

  it("403 tanpa menu dompet, lib tidak dipanggil", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const res = await call(MEMBER, { amount: 1000, reason: "x" });
    expect(res.status).toBe(403);
    expect(applyAdjustment).not.toHaveBeenCalled();
  });

  it("400 untuk ID bukan UUID dan body tidak valid (pesan isu pertama)", async () => {
    expect((await call("abc", { amount: 1000, reason: "x" })).status).toBe(400);
    const res = await call(MEMBER, { amount: "seribu", reason: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: expect.any(String) });
    expect(applyAdjustment).not.toHaveBeenCalled();
  });

  it("201 dengan aktor staf; WalletError diteruskan dengan statusnya", async () => {
    applyAdjustment.mockResolvedValueOnce({ id: "entry-1" });
    const ok = await call(MEMBER, { amount: -5000, reason: "salah input" });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ success: true, data: { id: "entry-1" } });
    expect(applyAdjustment).toHaveBeenCalledWith({
      customerId: MEMBER, amount: -5000, reason: "salah input", actor: { id: "staff-1", name: "Rina" },
    });

    applyAdjustment.mockRejectedValueOnce(new WalletError("Saldo tidak cukup", 409));
    const conflict = await call(MEMBER, { amount: -999999, reason: "x" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ success: false, error: "Saldo tidak cukup" });
  });
});
