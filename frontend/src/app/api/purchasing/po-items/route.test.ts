// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn(() => ({})) }));
vi.mock("@/lib/purchasing/po-lifecycle", () => ({ listPurchaseOrderItems: vi.fn() }));

import { listPurchaseOrderItems } from "@/lib/purchasing/po-lifecycle";
import { GET } from "./route";

const get = (query = "") => GET(new NextRequest(`http://localhost/api/purchasing/po-items${query}`));

describe("GET /api/purchasing/po-items", () => {
  it("requires po_id (400)", async () => {
    const res = await get();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "po_id parameter required" });
  });

  it("passes IAM denials through as 403", async () => {
    vi.mocked(requireIamMenuPrefix).mockRejectedValueOnce(ApiError.forbidden());
    const res = await get("?po_id=po-1");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
  });

  it("lists items without the SKU relation", async () => {
    vi.mocked(listPurchaseOrderItems).mockResolvedValueOnce([{ id: "item-1" }]);
    const res = await get("?po_id=po-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: [{ id: "item-1" }],
      message: "PO items retrieved",
    });
    expect(vi.mocked(listPurchaseOrderItems).mock.calls[0]).toEqual([{}, "po-1"]);
  });
});
