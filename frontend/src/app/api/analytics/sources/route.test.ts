import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});

let result: { data: unknown; error: unknown } = { data: [], error: null };
const builder: Record<string, unknown> = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return () => builder;
    },
  }
);
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: async () => ({ from: () => builder }) }));

function request(): NextRequest {
  return { nextUrl: new URL("http://localhost/api/analytics/sources") } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireIamMenuPrefix.mockResolvedValue({ id: "u-1" });
});

describe("GET /api/analytics/sources", () => {
  it("401 dari guard", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.unauthorized());
    const { GET } = await import("./route");
    expect((await GET(request())).status).toBe(401);
  });

  it("rate hired per sumber", async () => {
    result = {
      data: [
        { source: "jobstreet", status: "hired" },
        { source: "jobstreet", status: "applied" },
        { source: "jobstreet", status: "applied" },
      ],
      error: null,
    };
    const { GET } = await import("./route");
    expect(await (await GET(request())).json()).toEqual({
      data: [{ source: "JobStreet", total: 3, hired: 1, rate: 33.3 }],
    });
  });
});
