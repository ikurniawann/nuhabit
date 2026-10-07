// getPortalOptions reads the job opening from recruitment.job_openings
// (hris.job_openings does not exist, so every ?opening= request was a 500).
import { describe, expect, it, vi } from "vitest";

const queryOne = vi.fn(async () => ({ brand_id: "b1", position_id: "p1" }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: (...args: unknown[]) => queryOne(...(args as [])),
}));

const { getPortalOptions } = await import("./portal-application");

describe("getPortalOptions", () => {
  it("auto-fills from recruitment.job_openings", async () => {
    const res = await getPortalOptions("11111111-1111-4111-8111-111111111111");
    expect(res.opening).toEqual({ brand_id: "b1", position_id: "p1" });
    const [sql] = queryOne.mock.calls[0] as unknown as [string];
    expect(sql).toContain("FROM recruitment.job_openings");
  });

  it("skips the lookup for a malformed id", async () => {
    queryOne.mockClear();
    expect((await getPortalOptions("abc")).opening).toBeNull();
    expect(queryOne).not.toHaveBeenCalled();
  });
});
