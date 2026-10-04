import { describe, expect, it } from "vitest";
import {
  CONTINUE_OPEN_BILL_MESSAGE,
  canAppendTransferItems,
  canMergeIntoDestination,
  planCheckoutAppend,
  resolvePaidMixedOnOccupiedTable,
  newCartItemsForOpenBillAppend,
  resolveOpenBillCheckoutId,
  resolveOpenBillOfferDiscount,
  resolveTableSaleTarget,
  resolveUnpaidCheckoutForOpenBill,
  shouldReuseUnpaidOpenBillCheckout,
} from "./table-sale-target";

describe("resolveTableSaleTarget", () => {
  it("always creates a new stall order, even beside an unpaid checkout", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "stall",
        unpaidCentralCheckoutId: "chk-1",
      })
    ).toEqual({ action: "create_order" });
  });

  it("appends kasir pusat mixed items onto that table's unpaid central checkout", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_mixed",
        unpaidCentralCheckoutId: "chk-1",
      })
    ).toEqual({ action: "append_checkout", checkoutId: "chk-1" });
  });

  it("opens a new checkout when the table only has stall orders", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_mixed",
        unpaidCentralCheckoutId: null,
      })
    ).toEqual({ action: "create_checkout" });
  });

  it("opens a new checkout after the previous central bill is paid", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_mixed",
      })
    ).toEqual({ action: "create_checkout" });
  });

  it("sends only newly added cart lines when continuing an open bill", () => {
    expect(
      newCartItemsForOpenBillAppend({
        items: [
          { id: "persisted-1", name: "Age Gyoza" },
          { id: "new-1", name: "Extra Mochi" },
        ],
        persistedItemIds: ["persisted-1"],
      })
    ).toEqual([{ id: "new-1", name: "Extra Mochi" }]);
    expect(
      newCartItemsForOpenBillAppend({
        items: [{ id: "persisted-1", name: "Age Gyoza" }],
        persistedItemIds: ["persisted-1"],
      })
    ).toEqual([]);
  });

  it("prefers an explicit checkout id so takeaway/no-table add-on appends", () => {
    expect(
      resolveOpenBillCheckoutId({
        explicitCheckoutId: "chk-5",
        tableUnpaidCheckoutId: "chk-table",
      })
    ).toBe("chk-5");
    expect(
      resolveOpenBillCheckoutId({
        explicitCheckoutId: null,
        tableUnpaidCheckoutId: "chk-table",
      })
    ).toBe("chk-table");
    expect(
      resolveOpenBillCheckoutId({
        explicitCheckoutId: "  ",
        tableUnpaidCheckoutId: null,
      })
    ).toBeNull();
  });

  it("does not append a QRIS instant sale onto the table's unpaid checkout", () => {
    expect(shouldReuseUnpaidOpenBillCheckout(false)).toBe(false);
    expect(shouldReuseUnpaidOpenBillCheckout(undefined)).toBe(true);
    expect(
      resolveUnpaidCheckoutForOpenBill({
        reuseUnpaidCheckout: false,
        explicitCheckoutId: null,
        tableUnpaidCheckoutId: "chk-table",
      })
    ).toBeNull();
    expect(
      resolveUnpaidCheckoutForOpenBill({
        reuseUnpaidCheckout: true,
        explicitCheckoutId: null,
        tableUnpaidCheckoutId: "chk-table",
      })
    ).toBe("chk-table");
  });

  it("keeps the cashier on-screen offer amount when saving the QRIS bill", () => {
    expect(
      resolveOpenBillOfferDiscount({
        clientOfferDiscount: 30_000,
        serverOfferDiscount: 0,
      })
    ).toBe(30_000);
    expect(
      resolveOpenBillOfferDiscount({
        clientOfferDiscount: null,
        serverOfferDiscount: 15_000,
      })
    ).toBe(15_000);
    expect(
      resolveOpenBillOfferDiscount({
        clientOfferDiscount: 0,
        serverOfferDiscount: 15_000,
      })
    ).toBe(0);
  });

  it("appends a 1-stall kasir pusat open-bill onto that table's unpaid checkout", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_single",
        unpaidCentralCheckoutId: "chk-1",
      })
    ).toEqual({ action: "append_checkout", checkoutId: "chk-1" });
  });

  it("keeps a 1-stall kasir pusat sale on the order path when the table has no checkout", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_single",
        unpaidCentralCheckoutId: null,
      })
    ).toEqual({ action: "create_order" });
  });
});

describe("canAppendTransferItems", () => {
  it("allows stall → stall and central → central", () => {
    expect(
      canAppendTransferItems({ sold_from: "stall" }, { sold_from: "stall" })
    ).toBe(true);
    expect(
      canAppendTransferItems(
        { checkout_id: "chk-1", sold_from: "central" },
        { checkout_id: "chk-1", sold_from: "central" }
      )
    ).toBe(true);
  });

  it("rejects merging a stall order into a central checkout", () => {
    expect(
      canAppendTransferItems(
        { sold_from: "stall", checkout_id: null },
        { sold_from: "central", checkout_id: "chk-1" }
      )
    ).toBe(false);
  });
});

describe("canMergeIntoDestination", () => {
  it("rejects stall → central child and mixed-family destinations", () => {
    expect(
      canMergeIntoDestination(
        { sold_from: "stall", checkout_id: null },
        [{ sold_from: "central", checkout_id: "chk-1" }]
      )
    ).toBe(false);
    expect(
      canMergeIntoDestination(
        { sold_from: "stall", checkout_id: null },
        [
          { sold_from: "stall", checkout_id: null },
          { sold_from: "central", checkout_id: "chk-1" },
        ]
      )
    ).toBe(false);
  });

  it("allows stall → stall when the destination is a single family", () => {
    expect(
      canMergeIntoDestination(
        { sold_from: "stall", checkout_id: null },
        [{ sold_from: "stall", checkout_id: null }]
      )
    ).toBe(true);
  });
});

describe("planCheckoutAppend", () => {
  it("appends onto an existing child for the same stall", () => {
    expect(
      planCheckoutAppend({
        incomingWarehouseIds: ["w-a"],
        existingCentralChildren: [{ id: "child-a", warehouse_id: "w-a" }],
        tableOrders: [
          { id: "child-a", warehouse_id: "w-a", checkout_id: "chk-1", sold_from: "central" },
          { id: "stall-1", warehouse_id: "w-a", checkout_id: null, sold_from: "stall" },
        ],
      })
    ).toEqual({
      children: [{ action: "append", orderId: "child-a", warehouseId: "w-a" }],
      untouchedStallOrderIds: ["stall-1"],
    });
  });

  it("opens a new child when the stall is not yet on the checkout", () => {
    expect(
      planCheckoutAppend({
        incomingWarehouseIds: ["w-b"],
        existingCentralChildren: [{ id: "child-a", warehouse_id: "w-a" }],
        tableOrders: [
          { id: "child-a", warehouse_id: "w-a", checkout_id: "chk-1", sold_from: "central" },
          { id: "stall-1", warehouse_id: "w-b", checkout_id: null, sold_from: "stall" },
        ],
      })
    ).toEqual({
      children: [{ action: "create_child", warehouseId: "w-b" }],
      untouchedStallOrderIds: ["stall-1"],
    });
  });

  it("does not touch stall orders when appending mixed stalls", () => {
    const plan = planCheckoutAppend({
      incomingWarehouseIds: ["w-a", "w-c"],
      existingCentralChildren: [{ id: "child-a", warehouse_id: "w-a" }],
      tableOrders: [
        { id: "child-a", warehouse_id: "w-a", checkout_id: "chk-1", sold_from: "central" },
        { id: "stall-1", warehouse_id: "w-a", checkout_id: null, sold_from: "stall" },
        { id: "stall-2", warehouse_id: "w-c", checkout_id: null, sold_from: "stall" },
      ],
    });
    expect(plan.untouchedStallOrderIds).toEqual(["stall-1", "stall-2"]);
    expect(plan.children).toEqual([
      { action: "append", orderId: "child-a", warehouseId: "w-a" },
      { action: "create_child", warehouseId: "w-c" },
    ]);
  });
});

describe("resolvePaidMixedOnOccupiedTable", () => {
  it("rejects pay-now mixed when the table already has an unpaid checkout", () => {
    expect(
      resolvePaidMixedOnOccupiedTable({ unpaidCentralCheckoutId: "chk-1" })
    ).toEqual({ action: "reject", message: CONTINUE_OPEN_BILL_MESSAGE });
  });

  it("allows a new paid checkout when the table has no central bill", () => {
    expect(
      resolvePaidMixedOnOccupiedTable({ unpaidCentralCheckoutId: null })
    ).toEqual({ action: "create" });
  });
});
