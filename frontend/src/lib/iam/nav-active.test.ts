import { describe, expect, it } from "vitest";
import { isNavLinkActive } from "./nav-active";

describe("isNavLinkActive", () => {
  const posLeaves = [
    "/dashboard/pos",
    "/dashboard/pos/tables",
    "/dashboard/pos/cashier-new",
    "/dashboard/pos/reports/profit",
  ];

  it("keeps exact dashboard match active", () => {
    expect(isNavLinkActive("/dashboard/pos", "/dashboard/pos", posLeaves)).toBe(
      true
    );
  });

  it("does not keep /dashboard/pos active when on /dashboard/pos/tables", () => {
    expect(
      isNavLinkActive("/dashboard/pos/tables", "/dashboard/pos", posLeaves)
    ).toBe(false);
  });

  it("activates the tables leaf on /dashboard/pos/tables", () => {
    expect(
      isNavLinkActive("/dashboard/pos/tables", "/dashboard/pos/tables", posLeaves)
    ).toBe(true);
  });

  it("blocks parent dashboard when on a nested reports path", () => {
    expect(
      isNavLinkActive(
        "/dashboard/pos/reports/profit",
        "/dashboard/pos",
        posLeaves
      )
    ).toBe(false);
  });
});
