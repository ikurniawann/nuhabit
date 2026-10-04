import { describe, expect, it } from "vitest";
import { orderToPreviewReceipt } from "./order-to-receipt";
import type { Order } from "@/lib/pos-api";

describe("orderToPreviewReceipt", () => {
  it("maps order lines and totals for preview bill", () => {
    const order = {
      id: "ord-1",
      order_number: "ORD-1001",
      order_type: "dine_in",
      notes: "No ice",
      discount_amount: 1000,
      tax_amount: 900,
      total_amount: 10900,
      customer: { name: "Ada", phone: "08123456789" },
      items: [
        {
          id: "line-1",
          product_id: "p1",
          product_name: "Latte",
          quantity: 2,
          unit_price: 5000,
          total_amount: 10000,
          variants: [{ name: "Large" }],
          modifiers: [{ name: "Oat" }],
        },
      ],
    } as Order;

    const payload = orderToPreviewReceipt(order, "B-04");

    expect(payload.orderId).toBe("ord-1");
    expect(payload.orderNumber).toBe("ORD-1001");
    expect(payload.table).toBe("B-04");
    expect(payload.customerName).toBe("Ada · 08123456789");
    expect(payload.discountAmount).toBe(1000);
    expect(payload.taxAmount).toBe(900);
    expect(payload.total).toBe(10900);
    expect(payload.change).toBe(0);
    expect(payload.paymentMethod).toBe("unpaid");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      name: "Latte",
      quantity: 2,
      price: 5000,
      variantName: "Large",
      modifierNames: ["Oat"],
    });
  });

  it("falls back to Walk-in when customer missing", () => {
    const order = {
      id: "ord-2",
      order_type: "dine_in",
      total_amount: 0,
      items: [],
    } as Order;

    expect(orderToPreviewReceipt(order, null).customerName).toBe("Walk-in");
  });
});
