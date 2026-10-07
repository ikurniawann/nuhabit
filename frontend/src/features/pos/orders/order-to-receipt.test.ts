import { describe, expect, it } from "vitest";
import {
  checkoutFamilyToReceiptPayload,
  orderToReceiptPayload,
} from "@/features/pos/orders/order-to-receipt";
import type { Order } from "@/features/pos/orders/types";

describe("orderToReceiptPayload", () => {
  it("maps order fields into ReceiptPayload", () => {
    const order = {
      id: "ord-1",
      order_number: "POS-001",
      queue_number: "A12",
      order_type: "dine_in",
      payment_method: "cash",
      total_amount: 25000,
      change_amount: 5000,
      discount_amount: 0,
      tax_amount: 2500,
      notes: "no onion",
      table: { table_number: "T3" },
      customer: {
        id: "c1",
        phone: "081",
        name: "Budi",
        membership_tier: "silver",
        ark_coin_balance: 0,
        total_xp: 0,
        total_spent: 0,
        visit_count: 0,
      },
      items: [
        {
          product_id: "p1",
          product_name: "Kopi",
          quantity: 2,
          unit_price: 10000,
          total_amount: 20000,
          variants: [{ name: "Hot", group: "Temp", price: 0 }],
          modifiers: [{ name: "Extra shot", group: "Add" }],
        },
      ],
    } as Order;

    const payload = orderToReceiptPayload(order);
    expect(payload.orderId).toBe("ord-1");
    expect(payload.orderNumber).toBe("POS-001");
    expect(payload.queueNumber).toBe("A12");
    expect(payload.table).toBe("T3");
    expect(payload.customerName).toBe("Budi");
    expect(payload.total).toBe(25000);
    expect(payload.change).toBe(5000);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.name).toBe("Kopi");
    expect(payload.items[0]?.quantity).toBe(2);
    expect(payload.items[0]?.variantName).toBe("Hot");
    expect(payload.items[0]?.modifierNames).toEqual(["Extra shot"]);
  });

  it("tolerates modifiers/variants that are objects instead of arrays", () => {
    const order = {
      id: "ord-2",
      order_number: "POS-002",
      order_type: "takeaway",
      total_amount: 10000,
      items: [
        {
          product_id: "p2",
          product_name: "Teh",
          quantity: 1,
          unit_price: 10000,
          total_amount: 10000,
          variants: { 0: { name: "Large" } },
          modifiers: {},
        },
      ],
    } as Order;

    const payload = orderToReceiptPayload(order);
    expect(payload.items[0]?.variantName).toBe("Large");
    expect(payload.items[0]?.modifierNames).toBeUndefined();
  });
});

describe("checkoutFamilyToReceiptPayload", () => {
  it("menggabungkan semua anak-order: item ber-stall, angka dijumlah", () => {
    const family = [
      {
        id: "a",
        order_number: "POS-1",
        checkout_number: "CHK-9",
        queue_number: "007",
        order_type: "dine_in",
        payment_method: "qris",
        subtotal: 20_000,
        total_amount: 20_000,
        discount_amount: 0,
        tax_amount: 0,
        change_amount: 0,
        stall_name: "Yakitori Stall",
        items: [
          { product_id: "p1", product_name: "Negima", quantity: 1, unit_price: 20_000, total_amount: 20_000 },
        ],
      },
      {
        id: "b",
        order_number: "POS-2",
        order_type: "dine_in",
        payment_method: "qris",
        subtotal: 70_000,
        total_amount: 60_000,
        discount_amount: 10_000,
        tax_amount: 0,
        change_amount: 0,
        stall_name: "Rice bowl Stall",
        items: [
          { product_id: "p2", product_name: "Gyutan Donburi", quantity: 1, unit_price: 70_000, total_amount: 70_000 },
        ],
      },
    ] as never[];
    const payload = checkoutFamilyToReceiptPayload(family);
    expect(payload.items).toHaveLength(2);
    expect(payload.items.map((i) => i.stallName)).toEqual(["Yakitori Stall", "Rice bowl Stall"]);
    expect(payload.checkoutNumber).toBe("CHK-9");
    expect(payload.total).toBe(80_000);
    expect(payload.subtotal).toBe(90_000);
    expect(payload.discountAmount).toBe(10_000);
    expect(payload.paymentMethod).toBe("qris");
  });
});
