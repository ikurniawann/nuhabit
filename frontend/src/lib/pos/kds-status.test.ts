import { describe, expect, it } from "vitest";
import {
  deriveOrderKitchenStatus,
  deriveStationStatus,
  mapOrderStatusToKitchenStatus,
} from "@/lib/pos/kds-status";

describe("mapOrderStatusToKitchenStatus", () => {
  it("keeps confirmed as a kitchen step", () => {
    expect(mapOrderStatusToKitchenStatus("confirmed")).toBe("confirmed");
    expect(mapOrderStatusToKitchenStatus("preparing")).toBe("preparing");
    expect(mapOrderStatusToKitchenStatus("completed")).toBe("served");
  });
});

describe("deriveStationStatus", () => {
  it("uses the least advanced non-served item for a station", () => {
    const items = [
      { station: "kitchen", kitchen_status: "ready" },
      { station: "kitchen", kitchen_status: "pending" },
      { station: "bar", kitchen_status: "preparing" },
    ];
    expect(deriveStationStatus(items, "kitchen")).toBe("pending");
    expect(deriveStationStatus(items, "bar")).toBe("preparing");
  });

  it("returns served when station has no active items", () => {
    const items = [
      { station: "kitchen", kitchen_status: "served" },
      { station: "bar", kitchen_status: "pending" },
    ];
    expect(deriveStationStatus(items, "kitchen")).toBe("served");
  });
});

describe("deriveOrderKitchenStatus", () => {
  it("keeps kitchen workflow independent from payment", () => {
    const items = [
      { station: "kitchen", kitchen_status: "preparing" },
      { station: "bar", kitchen_status: "pending" },
    ];
    expect(deriveOrderKitchenStatus(items, "paid")).toEqual({
      kitchenStatus: "pending",
      orderStatus: "pending",
    });
  });

  it("marks completed only when all F&B items are served and paid", () => {
    const items = [
      { station: "kitchen", kitchen_status: "served" },
      { station: "bar", kitchen_status: "served" },
    ];
    expect(deriveOrderKitchenStatus(items, "paid").orderStatus).toBe("completed");
    expect(deriveOrderKitchenStatus(items, "unpaid").orderStatus).toBe("served");
  });

  it("stays preparing when only some items are ready (partial siap)", () => {
    const items = [
      { station: "kitchen", kitchen_status: "ready" },
      { station: "kitchen", kitchen_status: "preparing" },
      { station: "bar", kitchen_status: "ready" },
    ];
    expect(deriveOrderKitchenStatus(items, "paid")).toEqual({
      kitchenStatus: "preparing",
      orderStatus: "preparing",
    });
  });

  it("becomes ready when every active F&B item is ready", () => {
    const items = [
      { station: "kitchen", kitchen_status: "ready" },
      { station: "bar", kitchen_status: "ready" },
      { station: "kitchen", kitchen_status: "served" },
    ];
    expect(deriveOrderKitchenStatus(items, "unpaid")).toEqual({
      kitchenStatus: "ready",
      orderStatus: "ready",
    });
  });

  it("ignores merchandise when deriving kitchen status", () => {
    const items = [
      { station: "merchandise", kitchen_status: "pending" },
      { station: "kitchen", kitchen_status: "ready" },
    ];
    expect(deriveOrderKitchenStatus(items, "paid")).toEqual({
      kitchenStatus: "ready",
      orderStatus: "ready",
    });
  });
});
