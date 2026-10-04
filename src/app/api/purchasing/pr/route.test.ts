// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const user = { id: "user-1", full_name: "Rina", role: "purchasing_staff", brand_id: null };
const guard = vi.hoisted(() => ({ canCreate: true }));

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: vi.fn(async () => user),
    requireIamAction: vi.fn(async () => {
      if (!guard.canCreate) throw actual.ApiError.forbidden();
      return user;
    }),
  };
});
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
}));
vi.mock("@/lib/purchasing/pr-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/purchasing/pr-workflow")>();
  return { ...actual, createPurchaseRequest: vi.fn(actual.createPurchaseRequest) };
});
vi.mock("@/lib/purchasing/pr-queries", () => ({ listPurchaseRequests: vi.fn() }));

import { requireIamAction } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPurchaseRequest } from "@/lib/purchasing/pr-workflow";
import { listPurchaseRequests } from "@/lib/purchasing/pr-queries";
import { GET, POST } from "./route";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/purchasing/pr", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/purchasing/pr", () => {
  beforeEach(() => {
    guard.canCreate = true;
  });

  it("POST without the create grant on a PR menu is 403 before any write", async () => {
    guard.canCreate = false;
    const res = await POST(post({}));
    expect(res.status).toBe(403);
    expect(vi.mocked(requireIamAction)).toHaveBeenCalledWith(IAM.itemsPr, "create");
    expect(createPurchaseRequest).not.toHaveBeenCalled();
  });

  it("POST returns the first zod issue as a 400 error", async () => {
    const res = await POST(
      post({
        department_id: "11111111-1111-4111-8111-111111111111",
        priority: "low",
        items: [],
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: "Minimal 1 item" });
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("POST responds 201 with the created PR", async () => {
    vi.mocked(createPurchaseRequest).mockResolvedValueOnce({ id: "pr-1", pr_number: "PR-1" });
    const res = await POST(post({ module_type: "product" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: "pr-1", pr_number: "PR-1" } });
  });

  it("GET returns the list payload unchanged (no success wrapper)", async () => {
    const payload = {
      data: [{ id: "pr-1", requester_id: "user-1", requester_name: "Rina", department_name: undefined }],
      pagination: { page: 2, limit: 5, total: 6, totalPages: 2 },
    };
    vi.mocked(listPurchaseRequests).mockResolvedValueOnce(payload);
    const res = await GET(
      new NextRequest("http://localhost/api/purchasing/pr?page=2&limit=5&status=approved")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(vi.mocked(listPurchaseRequests).mock.calls[0][1]).toMatchObject({
      page: 2,
      limit: 5,
      status: "approved",
      moduleType: "raw_material",
    });
  });
});
