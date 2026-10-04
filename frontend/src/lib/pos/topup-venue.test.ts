import { describe, expect, it } from "vitest";
import { pickTopupVenue } from "./topup-venue";

const fallback = { companyId: "co-default", branchId: "br-default" };

describe("pickTopupVenue", () => {
  it("memakai cabang kasir yang login bila ada", () => {
    expect(pickTopupVenue({ company_id: "co1", branch_id: "br1" }, fallback)).toEqual({
      companyId: "co1",
      branchId: "br1",
    });
  });

  it("branch saja tetap dipakai (company diturunkan di lapisan DB)", () => {
    expect(pickTopupVenue({ company_id: null, branch_id: "br1" }, fallback)).toEqual({
      companyId: null,
      branchId: "br1",
    });
  });

  it("super admin tanpa cabang → venue default CRM", () => {
    expect(pickTopupVenue({ company_id: null, branch_id: null }, fallback)).toEqual(fallback);
    expect(pickTopupVenue(null, fallback)).toEqual(fallback);
  });

  it("tanpa fallback pun tidak melempar — null aman", () => {
    expect(pickTopupVenue(undefined, { companyId: null, branchId: null })).toEqual({
      companyId: null,
      branchId: null,
    });
  });
});
