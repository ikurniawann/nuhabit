import { describe, expect, it } from "vitest";
import { CASHIER_ROUTES } from "@/features/pos/cashier/constants";
import {
  RESTAURANT_FROM,
  RESTAURANT_PATH,
  RESTAURANT_TABLET_PATH,
  buildCashierHandoffUrl,
  isRestaurantImmersive,
  restaurantPath,
  shouldUseTabletCashierHandoff,
} from "./nav";

describe("isRestaurantImmersive", () => {
  it("is true when immersive=1", () => {
    expect(
      isRestaurantImmersive(new URLSearchParams("immersive=1"))
    ).toBe(true);
  });

  it("is true when tablet=1", () => {
    expect(isRestaurantImmersive(new URLSearchParams("tablet=1"))).toBe(true);
  });

  it("is true when immersive=true", () => {
    expect(
      isRestaurantImmersive(new URLSearchParams("immersive=true"))
    ).toBe(true);
  });

  it("is false when missing", () => {
    expect(isRestaurantImmersive(new URLSearchParams())).toBe(false);
  });
});

describe("restaurantPath", () => {
  it("returns base path by default", () => {
    expect(restaurantPath()).toBe(RESTAURANT_PATH);
    expect(restaurantPath({})).toBe(RESTAURANT_PATH);
  });

  it("uses dedicated tablet route when immersive requested", () => {
    expect(restaurantPath({ immersive: true })).toBe(RESTAURANT_TABLET_PATH);
  });
});

describe("shouldUseTabletCashierHandoff", () => {
  it("is true when restaurant shell is immersive", () => {
    expect(
      shouldUseTabletCashierHandoff({ immersive: true, handheldClient: false })
    ).toBe(true);
  });

  it("is true on handheld even without immersive restaurant URL", () => {
    expect(
      shouldUseTabletCashierHandoff({ immersive: false, handheldClient: true })
    ).toBe(true);
  });

  it("is false on desktop dashboard restaurant", () => {
    expect(
      shouldUseTabletCashierHandoff({ immersive: false, handheldClient: false })
    ).toBe(false);
  });
});

describe("buildCashierHandoffUrl", () => {
  it("always sets from=restaurant", () => {
    const url = buildCashierHandoffUrl({});

    expect(url).toMatch(new RegExp(`^${CASHIER_ROUTES.embedded}\\?`));
    expect(url).toContain("from=restaurant");
    expect(RESTAURANT_FROM).toBe("restaurant");
  });

  it("includes tableId", () => {
    expect(buildCashierHandoffUrl({ tableId: "abc" })).toContain(
      "tableId=abc"
    );
  });

  it("includes orderType takeaway", () => {
    expect(buildCashierHandoffUrl({ orderType: "takeaway" })).toContain(
      "orderType=takeaway"
    );
  });

  it("includes orderId", () => {
    expect(buildCashierHandoffUrl({ orderId: "ord-1" })).toContain(
      "orderId=ord-1"
    );
  });

  it("hands off checkoutId without a child orderId", () => {
    const url = buildCashierHandoffUrl({
      checkoutId: "chk-1",
      orderId: "child-0",
      tableId: "t5",
    });
    expect(url).toContain("checkoutId=chk-1");
    expect(url).toContain("tableId=t5");
    expect(url).not.toContain("orderId=");
  });

  it("includes pay flag", () => {
    expect(buildCashierHandoffUrl({ pay: true })).toContain("pay=1");
  });

  it("hands off to cashier fullscreen with tablet flags when immersive", () => {
    const url = buildCashierHandoffUrl({ immersive: true, tableId: "t1" });
    expect(url.startsWith(`${CASHIER_ROUTES.fullscreen}?`)).toBe(true);
    expect(url).toContain("immersive=1");
    expect(url).toContain("tablet=1");
    expect(url).toContain("tableId=t1");
  });

  it("omits immersive when not requested", () => {
    expect(buildCashierHandoffUrl({})).not.toContain("immersive=");
    expect(buildCashierHandoffUrl({})).not.toContain("tablet=");
  });
});
