import { describe, expect, it } from "vitest";
import {
  cashierDesktopRoute,
  cashierTabletRoute,
  isPosChromeLessPath,
  isPosDashboardPath,
  isPosImmersiveShell,
  isPosTabletQuery,
  needsCrossPosLayoutHardNav,
  restaurantTabletRoute,
  shouldShowSecondaryPosDisplays,
  withPosTabletParam,
} from "./tablet-mode";

describe("isPosChromeLessPath", () => {
  it("matches immersive POS shells outside dashboard", () => {
    expect(isPosChromeLessPath("/pos/kds")).toBe(true);
    expect(isPosChromeLessPath("/pos/queue?foo=1")).toBe(true);
    expect(isPosChromeLessPath("/pos/customer-display")).toBe(true);
    expect(isPosChromeLessPath("/dashboard/pos/kds")).toBe(false);
    expect(isPosChromeLessPath("/dashboard/pos/cashier-new")).toBe(false);
  });
});

describe("needsCrossPosLayoutHardNav", () => {
  it("hard-navs from POS tablet/cashier to back-office", () => {
    expect(
      needsCrossPosLayoutHardNav("/dashboard/pos/cashier-fullscreen", "/dashboard")
    ).toBe(true);
    expect(
      needsCrossPosLayoutHardNav("/dashboard/pos/tablet", "/dashboard/settings/roles")
    ).toBe(true);
  });

  it("hard-navs from back-office into POS dashboard", () => {
    expect(needsCrossPosLayoutHardNav("/dashboard/settings/roles", "/dashboard/pos")).toBe(
      true
    );
  });

  it("keeps soft nav inside the same layout", () => {
    expect(
      needsCrossPosLayoutHardNav("/dashboard/pos/cashier-new", "/dashboard/pos/restaurant")
    ).toBe(false);
    expect(
      needsCrossPosLayoutHardNav("/dashboard", "/dashboard/settings/roles")
    ).toBe(false);
  });

  it("still hard-navs chrome-less /pos/* shells", () => {
    expect(needsCrossPosLayoutHardNav("/dashboard", "/pos/kds")).toBe(true);
    expect(isPosDashboardPath("/dashboard/pos/tablet")).toBe(true);
    expect(isPosDashboardPath("/dashboard/settings/roles")).toBe(false);
  });
});

describe("isPosTabletQuery", () => {
  it("accepts 1 or true", () => {
    expect(isPosTabletQuery(new URLSearchParams("tablet=1"))).toBe(true);
    expect(isPosTabletQuery(new URLSearchParams("tablet=true"))).toBe(true);
    expect(isPosTabletQuery(new URLSearchParams("tablet=0"))).toBe(false);
  });
});

describe("isPosImmersiveShell", () => {
  it("is true for cashier-fullscreen", () => {
    expect(
      isPosImmersiveShell("/dashboard/pos/cashier-fullscreen", new URLSearchParams())
    ).toBe(true);
  });

  it("is true for kds fullscreen outside dashboard chrome", () => {
    expect(isPosImmersiveShell("/pos/kds", new URLSearchParams())).toBe(true);
  });

  it("is true for cashier tablet shortcut", () => {
    expect(
      isPosImmersiveShell("/dashboard/pos/tablet", new URLSearchParams())
    ).toBe(true);
  });

  it("is true for restaurant-tablet route", () => {
    expect(
      isPosImmersiveShell(
        "/dashboard/pos/restaurant-tablet",
        new URLSearchParams()
      )
    ).toBe(true);
  });

  it("is true for POS paths with tablet=1", () => {
    expect(
      isPosImmersiveShell(
        "/dashboard/pos/cashier-new",
        new URLSearchParams("tablet=1")
      )
    ).toBe(true);
  });

  it("is true for restaurant immersive query", () => {
    expect(
      isPosImmersiveShell(
        "/dashboard/pos/restaurant",
        new URLSearchParams("immersive=1")
      )
    ).toBe(true);
  });

  it("is false for normal dashboard POS", () => {
    expect(
      isPosImmersiveShell("/dashboard/pos/cashier-new", new URLSearchParams())
    ).toBe(false);
  });
});

describe("cashierTabletRoute", () => {
  it("points at fullscreen with tablet flag", () => {
    expect(cashierTabletRoute()).toBe(
      "/dashboard/pos/cashier-fullscreen?tablet=1"
    );
  });
});

describe("cashierDesktopRoute", () => {
  it("returns embedded cashier without tablet flags", () => {
    expect(cashierDesktopRoute()).toBe("/dashboard/pos/cashier-new");
  });

  it("strips tablet and immersive but keeps handoff params", () => {
    expect(
      cashierDesktopRoute(
        new URLSearchParams("tablet=1&immersive=1&from=restaurant&tableId=t1&pax=4")
      )
    ).toBe("/dashboard/pos/cashier-new?from=restaurant&tableId=t1&pax=4");
  });
});

describe("restaurantTabletRoute", () => {
  it("points at dedicated restaurant tablet path", () => {
    expect(restaurantTabletRoute()).toBe("/dashboard/pos/restaurant-tablet");
  });
});

describe("shouldShowSecondaryPosDisplays", () => {
  it("hides CFD and TV queue on immersive tablet shell", () => {
    expect(
      shouldShowSecondaryPosDisplays({ immersiveTablet: true, handheldClient: false })
    ).toBe(false);
  });

  it("hides CFD and TV queue on handheld even without tablet=1", () => {
    expect(
      shouldShowSecondaryPosDisplays({ immersiveTablet: false, handheldClient: true })
    ).toBe(false);
  });

  it("shows CFD and TV queue on desktop dashboard cashier", () => {
    expect(
      shouldShowSecondaryPosDisplays({ immersiveTablet: false, handheldClient: false })
    ).toBe(true);
  });
});

describe("withPosTabletParam", () => {
  it("appends tablet=1", () => {
    expect(withPosTabletParam("/dashboard/pos/restaurant")).toBe(
      "/dashboard/pos/restaurant?tablet=1"
    );
  });
});
