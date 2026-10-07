// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Result = { data: unknown; error: unknown };
let responses: Result[] = [];
const inserts: unknown[] = [];

function builder() {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "single"]) b[method] = () => b;
  b.insert = (payload: unknown) => {
    inserts.push(payload);
    return b;
  };
  b.then = (resolve: (value: Result | undefined) => unknown) => Promise.resolve(responses.shift()).then(resolve);
  return b;
}

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => ({ from: () => builder() })),
}));
vi.mock("@/lib/api/scope", () => ({
  getApiUserScope: vi.fn(async () => null),
  companyScopeOr: vi.fn(() => null),
  branchScopeOr: vi.fn(() => null),
}));

import { GET, POST } from "./route";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

describe("/api/purchasing/deliveries (legacy, no menu guard)", () => {
  beforeEach(() => {
    responses = [];
    inserts.length = 0;
  });

  it("POST without po_id is a 400 validation error", async () => {
    const res = await POST(
      new NextRequest("http://x/api/purchasing/deliveries", { method: "POST", body: JSON.stringify({}) })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation failed" });
  });

  it("POST 404s when the PO does not exist", async () => {
    responses = [{ data: null, error: null }];
    const res = await POST(
      new NextRequest("http://x/api/purchasing/deliveries", { method: "POST", body: JSON.stringify({ po_id: "po-x" }) })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Purchase order not found" });
  });

  it("POST inherits supplier and scope from the PO", async () => {
    responses = [
      { data: { supplier_id: "sup-1", company_id: "c-1", branch_id: null }, error: null },
      { data: { id: "d-1" }, error: null },
    ];
    const res = await POST(
      new NextRequest("http://x/api/purchasing/deliveries", {
        method: "POST",
        body: JSON.stringify({ po_id: "po-1", no_surat_jalan: "SJ" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "d-1" } });
    expect(inserts[0]).toEqual({
      po_id: "po-1",
      no_surat_jalan: "SJ",
      supplier_id: "sup-1",
      company_id: "c-1",
      branch_id: null,
      status: "IN_TRANSIT",
    });
  });

  it("GET lists deliveries", async () => {
    responses = [{ data: [{ id: "d-1" }], error: null }];
    const res = await GET(new NextRequest("http://x/api/purchasing/deliveries"));
    expect(await res.json()).toEqual({ data: [{ id: "d-1" }] });
  });
});
