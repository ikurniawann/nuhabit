import { describe, expect, it } from "vitest";
import type { CashierCheckout, CashierOrder } from "./api";
import { initialCashierSession } from "./cashier-session";
import { billLine, planHandoff, type HandoffParams } from "./handoff";

const params = (overrides: Partial<HandoffParams> = {}): HandoffParams => ({
  orderId: null,
  checkoutId: null,
  tableId: null,
  orderType: null,
  fromRestaurant: false,
  autoPay: false,
  freshEntry: false,
  ...overrides,
});

const order: CashierOrder = {
  id: "o1",
  order_number: "ORD-1",
  order_type: "takeaway",
  table_id: "t9",
  customer_id: "c1",
  notes: "pedas",
  items: [
    {
      id: "i1",
      product_id: "p1",
      product_name: "Kopi",
      quantity: 2,
      total_amount: 30_000,
      variants: [{ name: "Large" }],
      modifiers: [{ name: "Less sugar" }, {}],
      warehouse_id: "w1",
    },
  ],
};

const checkout: CashierCheckout = {
  ...order,
  id: "c1",
  order_number: undefined,
  checkout_number: "CO-7",
  items: [{ product_id: "p2", product_name: "Teh", quantity: 1, unit_price: 8_000, warehouse_id: "w2" }],
};

const session = initialCashierSession();

describe("billLine", () => {
  it("derives unit price from the line total and keeps variant/modifier names", () => {
    expect(billLine(order.items![0], 0, false)).toEqual({
      id: "i1",
      productId: "p1",
      name: "Kopi",
      price: 15_000,
      quantity: 2,
      variantName: "Large",
      modifierNames: ["Less sugar"],
      station: undefined,
    });
  });

  it("falls back to product-index ids and carries the stall only for checkouts", () => {
    const line = billLine(checkout.items![0], 3, true);
    expect(line.id).toBe("p2-3");
    expect(line.price).toBe(8_000);
    expect(line.warehouse_id).toBe("w2");
    expect(line.variantName).toBeUndefined();
  });
});

describe("planHandoff", () => {
  it("does nothing before the cart is hydrated, except auto pay", () => {
    const steps = planHandoff({
      hydrated: false,
      params: params({ orderId: "o1", autoPay: true, freshEntry: true, fromRestaurant: true }),
      order,
      checkout: undefined,
      session,
    });
    expect(steps).toEqual([{ type: "autoPay" }]);
  });

  it("loads an open order once per key", () => {
    const [step] = planHandoff({
      hydrated: true,
      params: params({ orderId: "o1" }),
      order,
      checkout: undefined,
      session,
    });
    expect(step).toMatchObject({
      type: "loadBill",
      bill: {
        key: "order:o1",
        number: "ORD-1",
        orderType: "takeaway",
        tableId: "t9",
        customerId: "c1",
        notes: "pedas",
      },
    });
    expect(step.type === "loadBill" && step.bill.persistedItemIds).toBeUndefined();

    const again = planHandoff({
      hydrated: true,
      params: params({ orderId: "o1" }),
      order,
      checkout: undefined,
      session: { ...session, bill: { ...session.bill, key: "order:o1" } },
    });
    expect(again).toEqual([]);
  });

  it("checkout wins over order and marks its lines as persisted", () => {
    const [step] = planHandoff({
      hydrated: true,
      params: params({ orderId: "o1", checkoutId: "c1" }),
      order,
      checkout,
      session,
    });
    expect(step.type).toBe("loadBill");
    if (step.type !== "loadBill") return;
    expect(step.bill.key).toBe("checkout:c1");
    expect(step.bill.number).toBe("CO-7");
    expect(step.bill.persistedItemIds).toEqual(["p2-0"]);
  });

  it("waits for bill data before loading or auto paying", () => {
    expect(
      planHandoff({
        hydrated: true,
        params: params({ checkoutId: "c1", autoPay: true }),
        order: undefined,
        checkout: undefined,
        session,
      })
    ).toEqual([]);
  });

  it("resets a fresh entry once", () => {
    const input = { hydrated: true, params: params({ freshEntry: true }), order: undefined, checkout: undefined };
    expect(planHandoff({ ...input, session })).toEqual([{ type: "freshReset" }]);
    expect(
      planHandoff({ ...input, session: { ...session, handoff: { ...session.handoff, freshResetDone: true } } })
    ).toEqual([]);
  });

  it("restaurant table forces dine-in and sets the table", () => {
    const steps = planHandoff({
      hydrated: true,
      params: params({ fromRestaurant: true, tableId: "t1", orderType: "takeaway" }),
      order: undefined,
      checkout: undefined,
      session,
    });
    expect(steps).toEqual([{ type: "restaurant", key: "t1|takeaway||", orderType: "dine_in", tableId: "t1" }]);
  });

  it("restaurant order type without table clears the table; unknown types leave it", () => {
    const takeaway = planHandoff({
      hydrated: true,
      params: params({ fromRestaurant: true, orderType: "takeaway" }),
      order: undefined,
      checkout: undefined,
      session,
    });
    expect(takeaway).toEqual([{ type: "restaurant", key: "|takeaway||", orderType: "takeaway", tableId: null }]);

    const other = planHandoff({
      hydrated: true,
      params: params({ fromRestaurant: true, orderType: "delivery" }),
      order: undefined,
      checkout: undefined,
      session,
    });
    expect(other).toEqual([{ type: "restaurant", key: "|delivery||", orderType: null, tableId: undefined }]);
  });

  it("orders steps: load bill, auto pay, then restaurant handoff", () => {
    const steps = planHandoff({
      hydrated: true,
      params: params({ orderId: "o1", autoPay: true, fromRestaurant: true, tableId: "t1" }),
      order,
      checkout: undefined,
      session,
    });
    expect(steps.map((step) => step.type)).toEqual(["loadBill", "autoPay", "restaurant"]);
  });
});
