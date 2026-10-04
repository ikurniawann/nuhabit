import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const iam = { allowed: true };
const query = vi.fn();
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  requireIamAction: vi.fn(async () => {
    if (!iam.allowed) throw ApiError.forbidden("Insufficient permissions");
    return { id: "admin-1" };
  }),
}));
vi.mock("@/lib/db", () => ({ query: (...a: unknown[]) => query(...a) }));
vi.mock("@/lib/pos/channel-pricing-server", () => ({
  loadChannelRule: async (code: string) => (code === "gofood" ? { code, markup_percent: 20 } : null),
}));

const valid = { markup_percent: 20.555, rounding_step: 1000, rounding_mode: "up", is_active: true };
async function put(code: string, body: unknown) {
  const { PUT } = await import("./route");
  const res = await PUT({ json: async () => body } as unknown as NextRequest, { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  iam.allowed = true;
  query.mockReset();
});

describe("PUT /api/pos/sales-channels/[code]", () => {
  it("tanpa izin → 403; channel tak dikenal → 404; aturan salah → 400", async () => {
    iam.allowed = false;
    expect((await put("gofood", valid)).status).toBe(403);
    iam.allowed = true;
    expect((await put("tokopedia", valid)).status).toBe(404);
    expect((await put("gofood", { ...valid, rounding_step: 7 })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("valid → markup dibulatkan 2 desimal, user tercatat", async () => {
    const { ROUNDING_MODES } = await import("@/lib/pos/channel-pricing");
    const res = await put("gofood", { ...valid, rounding_mode: ROUNDING_MODES[0] });
    expect(res.status).toBe(200);
    expect(query.mock.calls[0]?.[1]).toEqual(["gofood", 20.56, 1000, ROUNDING_MODES[0], true, "admin-1"]);
  });
});
