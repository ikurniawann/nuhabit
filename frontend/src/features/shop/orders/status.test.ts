import { describe, expect, it } from "vitest";
import { courierLabel, isPickupOrder, ORDER_STATUS_TABS, orderStatusLabel, orderStatusTone } from "./status";

describe("shop order status", () => {
  it("lists the pickup statuses as tabs with their own tone and label", () => {
    expect(ORDER_STATUS_TABS.map((tab) => tab.value)).toContain("ready_for_pickup");
    expect(ORDER_STATUS_TABS.map((tab) => tab.value)).toContain("picked_up");
    expect(orderStatusTone("ready_for_pickup")).not.toBe(orderStatusTone("unknown"));
    expect(orderStatusLabel("ready_for_pickup")).toBe("siap diambil");
    expect(orderStatusLabel("paid")).toBe("paid");
  });

  it("labels a pickup order by its branch instead of a courier", () => {
    const shipped = { courier_code: "jne", courier_service: "reg", delivery_method: "ship" };
    const pickup = { courier_code: null, courier_service: null, delivery_method: "pickup", pickup_branch_name: "Dago" };
    expect(isPickupOrder(shipped)).toBe(false);
    expect(courierLabel(shipped)).toBe("jne reg");
    expect(courierLabel(pickup)).toBe("Ambil di Dago");
    expect(courierLabel({ ...pickup, pickup_branch_name: null })).toBe("Ambil di cabang");
    expect(courierLabel({ courier_code: null, courier_service: null })).toBe("—");
  });
});
