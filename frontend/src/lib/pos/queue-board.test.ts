import { describe, expect, it } from "vitest";
import {
  queueItemProgress,
  readyItemKeys,
  splitQueueBoardOrders,
} from "@/lib/pos/queue-board";
import type { KDSOrder } from "@/lib/pos/kds-types";

function order(partial: Partial<KDSOrder> & { id: string }): KDSOrder {
  return {
    order_number: partial.order_number || partial.id,
    status: "pending",
    payment_status: "unpaid",
    order_type: "dine_in",
    ordered_at: new Date().toISOString(),
    pos_order_items: [],
    wait_seconds: 0,
    wait_minutes: 0,
    is_overdue: false,
    is_urgent: false,
    ...partial,
  };
}

describe("splitQueueBoardOrders", () => {
  it("splits preparing vs ready and sorts by queue number", () => {
    const { preparing, ready } = splitQueueBoardOrders([
      order({ id: "a", queue_number: "012", station_status: "ready" }),
      order({ id: "b", queue_number: "003", status: "preparing" }),
      order({ id: "c", queue_number: "001", station_status: "pending" }),
      order({ id: "d", queue_number: "002", station_status: "ready" }),
      order({ id: "e", queue_number: "099", status: "served" }),
    ]);

    expect(preparing.map((row) => row.queue_number)).toEqual(["001", "003"]);
    expect(ready.map((row) => row.queue_number)).toEqual(["002", "012"]);
  });

  it("puts partial-ready tickets on Siap diambil without waiting for all items", () => {
    const { preparing, ready } = splitQueueBoardOrders([
      order({
        id: "late",
        queue_number: "001",
        station_status: "preparing",
        pos_order_items: [
          {
            id: "i1",
            product_id: "p",
            product_name: "A",
            product_sku: "a",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "preparing",
          },
        ],
      }),
      order({
        id: "partial",
        queue_number: "009",
        station_status: "preparing",
        pos_order_items: [
          {
            id: "i2",
            product_id: "p",
            product_name: "B",
            product_sku: "b",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "ready",
          },
          {
            id: "i3",
            product_id: "p",
            product_name: "C",
            product_sku: "c",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "preparing",
          },
        ],
      }),
    ]);

    // Masih ada yang dimasak → tetap di preparing
    expect(preparing.map((row) => row.id)).toEqual(["partial", "late"]);
    // Sudah ada item siap → muncul juga di siap diambil
    expect(ready.map((row) => row.id)).toEqual(["partial"]);
  });
});

describe("queueItemProgress", () => {
  it("counts ready vs pending active items", () => {
    const progress = queueItemProgress(
      order({
        id: "x",
        pos_order_items: [
          {
            id: "a",
            product_id: "p",
            product_name: "A",
            product_sku: "a",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "ready",
          },
          {
            id: "b",
            product_id: "p",
            product_name: "B",
            product_sku: "b",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "preparing",
          },
          {
            id: "c",
            product_id: "p",
            product_name: "C",
            product_sku: "c",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "served",
          },
        ],
      })
    );
    expect(progress).toMatchObject({
      total: 2,
      readyCount: 1,
      pendingCount: 1,
      hasPartialReady: true,
      allReady: false,
    });
  });
});

describe("sourceQueueBoardOrders via splitQueueBoardOrders", () => {
  it("shows one queue row for three children of the same checkout", () => {
    const items = (id: string, status: string) => [
      {
        id,
        product_id: "p",
        product_name: id,
        product_sku: id,
        quantity: 1,
        unit_price: 1,
        kitchen_status: status,
      },
    ];
    const { preparing, ready } = splitQueueBoardOrders([
      order({
        id: "child-a",
        checkout_id: "chk-1",
        queue_number: "007",
        station_status: "preparing",
        pos_order_items: items("nasi", "preparing"),
      }),
      order({
        id: "child-b",
        checkout_id: "chk-1",
        queue_number: "007",
        station_status: "ready",
        pos_order_items: items("esteh", "ready"),
      }),
      order({
        id: "child-c",
        checkout_id: "chk-1",
        queue_number: "007",
        station_status: "preparing",
        pos_order_items: items("puding", "preparing"),
      }),
    ]);

    expect(preparing).toHaveLength(1);
    expect(ready).toHaveLength(1);
    expect(preparing[0]?.queue_number).toBe("007");
    expect(preparing[0]?.pos_order_items.map((item) => item.id)).toEqual([
      "nasi",
      "esteh",
      "puding",
    ]);
  });
});

describe("readyItemKeys", () => {
  it("keys ready items for chime tracking", () => {
    const keys = readyItemKeys([
      order({
        id: "o1",
        station_status: "preparing",
        pos_order_items: [
          {
            id: "i1",
            product_id: "p",
            product_name: "A",
            product_sku: "a",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "ready",
          },
          {
            id: "i2",
            product_id: "p",
            product_name: "B",
            product_sku: "b",
            quantity: 1,
            unit_price: 1,
            kitchen_status: "preparing",
          },
        ],
      }),
    ]);
    expect([...keys]).toEqual(["o1:i1"]);
  });
});
