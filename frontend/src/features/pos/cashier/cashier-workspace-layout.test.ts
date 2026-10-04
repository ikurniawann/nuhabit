import { describe, expect, it } from "vitest";
import {
  cashierCartPanelClass,
  cashierLeftPanelClass,
  cashierProductGridClass,
  cashierProductScrollClass,
  cashierSplitRowClass,
} from "./cashier-workspace-layout";

describe("cashierSplitRowClass", () => {
  it("keeps tablet/immersive always side-by-side", () => {
    expect(
      cashierSplitRowClass({ isTabletMode: true, shellHeight: "h-[calc(100dvh-14rem)]" })
    ).toContain("flex-row");
    expect(
      cashierSplitRowClass({ isTabletMode: true, shellHeight: "h-[calc(100dvh-14rem)]" })
    ).not.toContain("flex-col");
  });

  it("uses 800px split on dashboard cashier, not lg", () => {
    const cls = cashierSplitRowClass({
      isTabletMode: false,
      shellHeight: "h-[calc(100dvh-14rem)] min-h-[480px]",
    });
    expect(cls).toContain("min-[800px]:flex-row");
    expect(cls).not.toContain("lg:flex-row");
    expect(cls).toContain("h-[calc(100dvh-14rem)]");
  });
});

describe("cashierCartPanelClass", () => {
  it("does not cap tablet cart at 60vh", () => {
    expect(cashierCartPanelClass(true)).toContain("max-h-none");
    expect(cashierCartPanelClass(true)).not.toContain("60vh");
  });

  it("drops 60vh cart cap from 800px on dashboard cashier", () => {
    const cls = cashierCartPanelClass(false);
    expect(cls).toContain("min-[800px]:max-h-none");
    expect(cls).toContain("min-[800px]:w-64");
    expect(cls).not.toContain("60vh");
  });
});

describe("cashierLeftPanelClass", () => {
  it("uses container queries so grid follows product pane, not viewport", () => {
    expect(cashierLeftPanelClass(false)).toContain("@container");
    expect(cashierLeftPanelClass(true)).toContain("@container");
  });
});

describe("cashierProductScrollClass", () => {
  it("keeps a min height so the grid cannot collapse to blank", () => {
    expect(cashierProductScrollClass()).toContain("min-h-[240px]");
    expect(cashierProductScrollClass()).toContain("flex-1");
  });
});

describe("cashierProductGridClass", () => {
  it("sizes columns from the product pane container, not viewport lg", () => {
    const cls = cashierProductGridClass();
    expect(cls).toContain("@min-[28rem]:grid-cols-4");
    expect(cls).not.toContain("lg:grid-cols");
  });
});
