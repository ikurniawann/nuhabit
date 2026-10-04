import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingPostError } from "@/lib/accounting/journal-mapping-posting";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));
const postMock = vi.fn();
vi.mock("@/lib/accounting/journal-mapping-posting", async (original) => ({
  ...(await original<typeof import("@/lib/accounting/journal-mapping-posting")>()),
  postJournalFromMapping: (...args: unknown[]) => postMock(...args),
}));

const { capitalizeLandedCosts, landedCostAmounts } = await import("./landed-cost");

beforeEach(() => {
  queryMock.mockReset();
  postMock.mockReset();
});

describe("landedCostAmounts (same cases as the Go domain test)", () => {
  it.each([
    [9000, 3000, { SUBTOTAL: 9000, COGS: 3000, TOTAL: 12000 }, null],
    [-9000, -1000.005, null, { SUBTOTAL: 9000, COGS: 1000.01, TOTAL: 10000.01 }],
    [-9000, 1000, { COGS: 1000, TOTAL: 1000 }, { SUBTOTAL: 9000, TOTAL: 9000 }],
    [0, 0, null, null],
  ])("splits %s capitalized and %s expensed", (capitalized, expensed, post, reverse) => {
    expect(landedCostAmounts(capitalized, expensed)).toEqual({ post, reverse });
  });
});

describe("capitalizeLandedCosts", () => {
  it("applies the costs and posts each batch, the reversal for value taken out", async () => {
    queryMock.mockResolvedValueOnce([
      { batch_id: "b1", cost_id: "c1", company_id: "co", capitalized: 12000, expensed: 0 },
      { batch_id: "b2", cost_id: "c2", company_id: null, capitalized: -500, expensed: 0 },
    ]);
    postMock.mockResolvedValue({ status: "posted" });
    const results = await capitalizeLandedCosts({ grnIds: ["g1"], userId: "u1" });
    expect(queryMock.mock.calls[0][0]).toContain("inventory.apply_landed_costs($1::uuid[], $2::uuid[], $3::uuid)");
    expect(queryMock.mock.calls[0][1]).toEqual([[], ["g1"], "u1"]);
    expect(postMock.mock.calls.map(([input]) => [input.eventCode, input.documentId, input.companyId, input.amounts])).toEqual([
      ["PURCHASE_LANDED_COST", "b1", "co", { SUBTOTAL: 12000, TOTAL: 12000 }],
      ["PURCHASE_LANDED_COST_REVERSAL", "b2", null, { SUBTOTAL: 500, TOTAL: 500 }],
    ]);
    expect(postMock.mock.calls[0][0]).toMatchObject({ documentType: "landed_cost", sourceModule: "PURCHASING" });
    expect(results).toHaveLength(2);
  });

  it("keeps the stock change when a journal cannot post", async () => {
    queryMock.mockResolvedValueOnce([{ batch_id: "b1", cost_id: "c1", company_id: "co", capitalized: 100, expensed: 0 }]);
    postMock.mockRejectedValueOnce(new AccountingPostError("Periode CLOSED"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await capitalizeLandedCosts({ costIds: ["c1"], userId: "u1" })).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
