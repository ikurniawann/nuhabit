import { describe, expect, it } from "vitest";
import {
  CASHIER_ROUTES,
  POS_ORDERS_PATH,
  RESTAURANT_ROUTE,
  buildPosOrdersUrl,
  cashierHomeFromOrders,
  posHomeFromOrders,
  restaurantHomeFromOrders,
  shouldResetCashierSession,
} from "./constants";

describe("buildPosOrdersUrl", () => {
  it("adds cashier return + tablet flags", () => {
    expect(buildPosOrdersUrl({ from: "cashier", tablet: true })).toBe(
      `${POS_ORDERS_PATH}?from=cashier&tablet=1&immersive=1`
    );
  });

  it("keeps a clean path without flags", () => {
    expect(buildPosOrdersUrl()).toBe(POS_ORDERS_PATH);
  });
});

describe("cashierHomeFromOrders", () => {
  it("returns fullscreen cashier when orders was opened from tablet POS", () => {
    expect(
      cashierHomeFromOrders(new URLSearchParams("from=cashier&tablet=1"))
    ).toBe(`${CASHIER_ROUTES.fullscreen}?tablet=1&immersive=1`);
  });

  it("returns desktop cashier otherwise", () => {
    expect(cashierHomeFromOrders(new URLSearchParams("from=cashier"))).toBe(
      CASHIER_ROUTES.embedded
    );
  });
});

describe("restaurantHomeFromOrders", () => {
  it("returns tablet restaurant when opened from immersive POS", () => {
    expect(
      restaurantHomeFromOrders(new URLSearchParams("from=restaurant&tablet=1"))
    ).toBe("/dashboard/pos/restaurant-tablet");
  });

  it("returns desktop restaurant otherwise", () => {
    expect(
      restaurantHomeFromOrders(new URLSearchParams("from=restaurant"))
    ).toBe(RESTAURANT_ROUTE);
  });
});

describe("posHomeFromOrders", () => {
  it("returns cashier back link", () => {
    expect(posHomeFromOrders(new URLSearchParams("from=cashier"))).toEqual({
      href: CASHIER_ROUTES.embedded,
      label: "Kembali ke POS",
    });
  });

  it("returns restaurant back link", () => {
    expect(posHomeFromOrders(new URLSearchParams("from=restaurant"))).toEqual({
      href: RESTAURANT_ROUTE,
      label: "Kembali ke Restaurant",
    });
  });

  it("returns null without from flag", () => {
    expect(posHomeFromOrders(new URLSearchParams())).toBeNull();
  });
});

describe("shouldResetCashierSession", () => {
  it("resets when POS is opened from the menu without a bill", () => {
    expect(
      shouldResetCashierSession(new URLSearchParams("tablet=1&immersive=1"))
    ).toBe(true);
  });

  it("keeps a handed-off checkout, order, or table", () => {
    expect(
      shouldResetCashierSession(new URLSearchParams("checkoutId=chk-1"))
    ).toBe(false);
    expect(
      shouldResetCashierSession(new URLSearchParams("orderId=ord-1"))
    ).toBe(false);
    expect(
      shouldResetCashierSession(new URLSearchParams("tableId=tbl-1"))
    ).toBe(false);
  });
});
