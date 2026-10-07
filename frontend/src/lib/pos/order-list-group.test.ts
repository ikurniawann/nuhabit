import { describe, expect, it } from "vitest";
import {
  canOpenOrderInCashier,
  cashierHandoffFromOrderListRow,
  groupOrdersByCheckout,
} from "./order-list-group";

describe("groupOrdersByCheckout", () => {
  it("keeps stall orders without checkout as single rows", () => {
    const rows = groupOrdersByCheckout([
      { id: "a", order_number: "POS-1", total_amount: 10000, ordered_at: "2026-08-16T01:00:00+07:00" },
    ]);
    expect(rows).toEqual([
      {
        kind: "single",
        order: expect.objectContaining({ id: "a" }),
      },
    ]);
  });

  it("collapses mixed-checkout children into one bill", () => {
    const rows = groupOrdersByCheckout([
      {
        id: "c1",
        checkout_id: "chk",
        checkout_number: "CHK-20260816-0003",
        order_number: "POS-4",
        total_amount: 60000,
        payment_status: "paid",
        status: "pending",
        ordered_at: "2026-08-16T08:58:54+07:00",
      },
      {
        id: "c2",
        checkout_id: "chk",
        checkout_number: "CHK-20260816-0003",
        order_number: "POS-5",
        total_amount: 155000,
        payment_status: "paid",
        status: "pending",
        ordered_at: "2026-08-16T08:58:54+07:00",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "checkout",
      checkoutId: "chk",
      checkoutNumber: "CHK-20260816-0003",
      total: 215000,
      paid: true,
    });
    if (rows[0]?.kind === "checkout") {
      expect(rows[0].orders).toHaveLength(2);
    }
  });

  it("hands mixed unpaid bills to cashier as checkoutId, never the first child", () => {
    const rows = groupOrdersByCheckout([
      {
        id: "child-bakery",
        checkout_id: "chk-5",
        checkout_number: "CHK-20260816-0005",
        order_number: "POS-12",
        payment_status: "unpaid",
        status: "pending",
      },
      {
        id: "child-sushi",
        checkout_id: "chk-5",
        checkout_number: "CHK-20260816-0005",
        order_number: "POS-13",
        payment_status: "unpaid",
        status: "pending",
      },
    ]);
    expect(cashierHandoffFromOrderListRow(rows[0]!)).toEqual({
      checkoutId: "chk-5",
    });
    expect(cashierHandoffFromOrderListRow(rows[0]!)).not.toHaveProperty("orderId");
  });

  it("hands a stall order to cashier as orderId", () => {
    const rows = groupOrdersByCheckout([
      { id: "stall-1", order_number: "POS-1", payment_status: "unpaid" },
    ]);
    expect(cashierHandoffFromOrderListRow(rows[0]!)).toEqual({
      orderId: "stall-1",
    });
  });
});

describe("canOpenOrderInCashier", () => {
  it("hides the action for voided orders even if they look unpaid", () => {
    expect(
      canOpenOrderInCashier([
        { id: "v1", status: "voided", payment_status: "unpaid" },
      ])
    ).toBe(false);
  });

  it("keeps the action for unpaid open bills", () => {
    expect(
      canOpenOrderInCashier([
        { id: "o1", status: "pending", payment_status: "unpaid" },
      ])
    ).toBe(true);
  });

  it("hides when every checkout child is voided", () => {
    expect(
      canOpenOrderInCashier([
        { id: "c1", status: "voided", payment_status: "unpaid" },
        { id: "c2", status: "voided", payment_status: "paid" },
      ])
    ).toBe(false);
  });
});
