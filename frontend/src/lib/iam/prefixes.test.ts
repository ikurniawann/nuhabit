import { describe, expect, it } from "vitest";
import { IAM } from "./prefixes";
import { hasAnyIamMenuPrefix } from "./match";

describe("IAM prefixes", () => {
  it("lets a cashier menu satisfy POS operations", () => {
    expect(hasAnyIamMenuPrefix(["pos.operations.cashier"], IAM.posOperations)).toBe(true);
  });

  it("does not let ESS satisfy purchasing", () => {
    expect(hasAnyIamMenuPrefix(["ess.attendance"], IAM.items)).toBe(false);
  });
});
