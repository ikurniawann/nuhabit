// Kurs ARK = uang: GET cukup sesi kasir, PUT wajib izin update menu ARK & XP.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const iam = { allowed: true };
const save = vi.fn(async () => ({ ark_rate: 1000 }));
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
  requireIamAction: vi.fn(async (menus: string[], action: string) => {
    if (!iam.allowed) throw ApiError.forbidden("Insufficient permissions");
    return { id: "admin-1", menus, action };
  }),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/pos/loyalty-settings", () => ({
  loadPosLoyaltySettings: async () => ({ ark_rate: 1000 }),
  savePosLoyaltySettings: (...a: unknown[]) => save(...(a as [])),
}));

const valid = {
  ark_rate: 1000,
  topup_min_amount: 10000,
  topup_presets: [50000],
  topup_xp_enabled: true,
  topup_xp_mode: "fixed",
  topup_xp_value: 5,
  topup_xp_amount_step: 10000,
  spend_xp_enabled: true,
  spend_xp_amount_step: 1000,
  spend_xp_min: 0,
};

async function put(body: unknown) {
  const { PUT } = await import("./route");
  const res = await PUT({ json: async () => body } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  iam.allowed = true;
  save.mockClear();
});

describe("/api/pos/loyalty-settings", () => {
  it("GET mengembalikan pengaturan", async () => {
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ success: true, data: { ark_rate: 1000 } });
  });

  it("PUT tanpa izin menu → 403, tidak menyimpan", async () => {
    iam.allowed = false;
    expect((await put(valid)).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it("PUT valid → disimpan atas nama user ber-izin; body salah → 400", async () => {
    expect(await put(valid)).toMatchObject({ status: 200, json: { message: "Loyalty settings saved" } });
    expect(save).toHaveBeenCalledWith({}, valid, "admin-1");
    expect((await put({ ...valid, ark_rate: 0 })).status).toBe(400);
  });
});
