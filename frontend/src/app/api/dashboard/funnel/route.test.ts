import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});

let result: { data: unknown; error: unknown } = { data: [], error: null };
const calls: Array<[string, unknown[]]> = [];
/** Query builder tiruan: setiap method dicatat dan mengembalikan dirinya; await → `result`. */
const builder: Record<string, unknown> = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return (...args: unknown[]) => {
        calls.push([prop, args]);
        return builder;
      };
    },
  }
);
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: async () => ({ from: () => builder }) }));

function request(qs = ""): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/dashboard/funnel${qs}`) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  result = { data: [], error: null };
  requireIamMenuPrefix.mockResolvedValue({ id: "u-1" });
});

describe("GET /api/dashboard/funnel", () => {
  it("403 dari guard IAM", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const { GET } = await import("./route");
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
  });

  it("hitung tahap funnel dan filter brand", async () => {
    result = { data: [{ status: "applied" }, { status: "hired" }, { status: "rejected" }], error: null };
    const { GET } = await import("./route");
    const res = await GET(request("?brand_id=b-1&period=week"));
    const body = await res.json();
    expect(body[0]).toEqual({ stage: "Applied", count: 1 });
    expect(body.find((s: { stage: string }) => s.stage === "Hired").count).toBe(1);
    expect(calls).toContainEqual(["eq", ["brand_id", "b-1"]]);
  });

  it("galat query → 500 tanpa pesan internal", async () => {
    result = { data: null, error: { message: "relation missing" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Terjadi kesalahan server");
    spy.mockRestore();
  });
});
