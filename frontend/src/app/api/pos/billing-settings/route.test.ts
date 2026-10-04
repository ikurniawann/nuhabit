import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const iam = { allowed: true };
const upsert = vi.fn(async () => ({ id: "p1" }));
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
  requireIamAction: vi.fn(async () => {
    if (!iam.allowed) throw ApiError.forbidden("Insufficient permissions");
    return { id: "admin-1" };
  }),
}));
vi.mock("@/lib/api/scope", () => ({ getApiUserScope: async () => ({ branchId: "br-1" }) }));
vi.mock("@/lib/users/user-warehouses", () => ({ loadUserWarehouses: async () => [] }));
vi.mock("@/lib/auth/active-stall", () => ({ resolveActiveStallFromCookies: async () => ({ mode: "all" }) }));
vi.mock("@/lib/pos/billing-settings-server", () => ({
  listBillingProfiles: async () => [],
  listBranchesForBilling: async () => [],
  listWarehousesForBilling: async () => [],
  resolveBillingProfile: async (scope: unknown) => ({ scope, charges: [] }),
  upsertBillingProfile: (...a: unknown[]) => upsert(...(a as [])),
}));

const charge = {
  code: "tax",
  name: "PB1",
  charge_kind: "tax",
  calc_method: "percent",
  rate: 10,
  amount: 0,
  apply_order: 10,
  is_enabled: true,
  is_optional: false,
  base: "subtotal_after_discount",
};
const body = { branch_id: null, warehouse_id: null, name: "Default", charges: [charge] };

async function put(payload: unknown) {
  const { PUT } = await import("./route");
  const res = await PUT({ json: async () => payload } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  iam.allowed = true;
  upsert.mockClear();
});

describe("/api/pos/billing-settings", () => {
  it("GET resolve memakai scope sesi bila tanpa parameter", async () => {
    const { GET } = await import("./route");
    const res = await GET({ nextUrl: new URL("http://x/api/pos/billing-settings") } as unknown as NextRequest);
    expect(await res.json()).toMatchObject({ data: { profile: { scope: { branchId: "br-1", warehouseId: null } }, preview: null } });
  });

  it("PUT kasir tanpa izin settings.billing → 403", async () => {
    iam.allowed = false;
    expect((await put(body)).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("PUT kode dobel → 400; valid → kode huruf besar, updatedBy user ber-izin", async () => {
    expect((await put({ ...body, charges: [charge, { ...charge, code: "TAX" }] })).status).toBe(400);
    expect((await put(body)).status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ updatedBy: "admin-1", charges: [{ ...charge, code: "TAX" }] }));
  });
});
