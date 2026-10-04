import { describe, expect, it } from "vitest";
import { isPathAllowedByMenus } from "./access";

const RM_PR = "/dashboard/raw-material/purchasing/pr";
const PRODUCT_PR = "/dashboard/product/purchasing/pr";
const RM_PO = "/dashboard/raw-material/purchasing/po";
const HOME = "/dashboard";

describe("isPathAllowedByMenus", () => {
  it("keeps /dashboard exact-only so Beranda does not open every module", () => {
    expect(isPathAllowedByMenus("/dashboard", [HOME, RM_PR])).toBe(true);
    expect(isPathAllowedByMenus("/dashboard/raw-material/purchasing/pr", [HOME])).toBe(false);
  });

  it("allows PR list and PR detail under the granted PR menu", () => {
    expect(isPathAllowedByMenus(RM_PR, [RM_PR])).toBe(true);
    expect(isPathAllowedByMenus(`${RM_PR}/abc`, [RM_PR])).toBe(true);
  });

  it("allows shared print/PR URL when the user has a Purchase Request menu", () => {
    const printPr = "/dashboard/purchasing/print/pr/abc";
    expect(isPathAllowedByMenus(printPr, [RM_PR])).toBe(true);
    expect(isPathAllowedByMenus(printPr, [PRODUCT_PR])).toBe(true);
  });

  it("allows rewritten raw-material print/PR URL under the same PR grant", () => {
    expect(
      isPathAllowedByMenus("/dashboard/raw-material/purchasing/print/pr/abc", [RM_PR])
    ).toBe(true);
  });

  it("rejects print/PR when the user has no PR menu", () => {
    expect(isPathAllowedByMenus("/dashboard/purchasing/print/pr/abc", [HOME, RM_PO])).toBe(
      false
    );
  });

  it("allows shared print/PO URL when the user has a Purchase Order menu", () => {
    expect(isPathAllowedByMenus("/dashboard/purchasing/print/po/abc", [RM_PO])).toBe(true);
    expect(isPathAllowedByMenus("/dashboard/purchasing/print/po/abc", [RM_PR])).toBe(false);
  });
});
