// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadReceivingWorkspace = vi.fn();

vi.mock("@/lib/purchasing/receiving-workspace", () => ({
  loadReceivingWorkspace: (...args: unknown[]) => loadReceivingWorkspace(...args),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn(() => ({})) }));
vi.mock("@/lib/purchasing/module-scope", () => ({
  parsePurchasingModuleType: (value: string | null) => value || "raw_material",
}));

import { GET } from "./route";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

describe("GET /api/purchasing/receiving-workspace (no menu guard)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the workspace for the requested module", async () => {
    const data = { purchase_orders: [], deliveries: [{ id: "d-1" }], grns: [] };
    loadReceivingWorkspace.mockResolvedValue(data);
    const res = await GET(new Request("http://x/api/purchasing/receiving-workspace?module_type=product"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data });
    expect(loadReceivingWorkspace.mock.calls[0][1]).toBe("product");
  });

  it("hides internal errors behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadReceivingWorkspace.mockRejectedValue(new Error("relation v_purchase_orders does not exist"));
    const res = await GET(new Request("http://x/api/purchasing/receiving-workspace"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Terjadi kesalahan server" });
  });
});
