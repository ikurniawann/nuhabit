import { describe, expect, it } from "vitest";
import {
  resolveWarehouseBranchFilter,
  resolveWarehouseCompanyFilter,
  type UserScope,
} from "./scope";

const base: UserScope = {
  userId: "u-1",
  role: "admin",
  businessScope: null,
  holdingId: null,
  companyId: null,
  branchId: null,
  isUnscoped: false,
};

describe("resolveWarehouseCompanyFilter", () => {
  it("user bercope company → company miliknya", () => {
    const scope: UserScope = { ...base, businessScope: "company", companyId: "co-apparel" };
    expect(resolveWarehouseCompanyFilter(scope)).toBe("co-apparel");
    // Branch filter tidak ikut campur untuk scope company.
    expect(resolveWarehouseBranchFilter(scope, "br-ctx")).toBe("br-ctx");
  });

  it("user bercope branch → null (sudah dibatasi lewat branch filter)", () => {
    const scope: UserScope = {
      ...base,
      businessScope: "branch",
      companyId: "co-apparel",
      branchId: "br-workshop",
    };
    expect(resolveWarehouseCompanyFilter(scope)).toBeNull();
    expect(resolveWarehouseBranchFilter(scope, "br-ctx")).toBe("br-workshop");
  });

  it("super_admin / unscoped / holding → null", () => {
    expect(resolveWarehouseCompanyFilter(null)).toBeNull();
    expect(
      resolveWarehouseCompanyFilter({ ...base, role: "super_admin", isUnscoped: true })
    ).toBeNull();
    expect(
      resolveWarehouseCompanyFilter({ ...base, businessScope: "holding", holdingId: "h1" })
    ).toBeNull();
  });
});
