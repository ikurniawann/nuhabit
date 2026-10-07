import { describe, expect, it } from "vitest";
import {
  computeStallAllAccess,
  isSellStallAllowed,
  resolveDefaultWarehouseId,
  resolveSavedWarehouseIds,
} from "./stall-assignment";

describe("resolveDefaultWarehouseId", () => {
  it("prefers explicit default over warehouse_ids", () => {
    expect(
      resolveDefaultWarehouseId({
        defaultWarehouseId: "w-home",
        warehouseIds: ["w-other"],
      })
    ).toBe("w-home");
  });

  it("falls back to first warehouse_id", () => {
    expect(
      resolveDefaultWarehouseId({
        defaultWarehouseId: null,
        warehouseIds: ["w-a", "w-b"],
      })
    ).toBe("w-a");
  });
});

describe("resolveSavedWarehouseIds", () => {
  it("stores only the default stall as placement", () => {
    expect(
      resolveSavedWarehouseIds({
        defaultWarehouseId: "w-1",
        warehouseIds: ["w-1", "w-2"],
        canSwitchStall: true,
      })
    ).toEqual(["w-1"]);
  });

  it("returns empty when no default is set", () => {
    expect(
      resolveSavedWarehouseIds({
        defaultWarehouseId: "",
        warehouseIds: [],
        canSwitchStall: false,
      })
    ).toEqual([]);
  });
});

describe("computeStallAllAccess", () => {
  it("is true when can_switch_stall is enabled", () => {
    expect(
      computeStallAllAccess({
        role: "pos",
        canSwitchStall: true,
        assignedMainStorage: false,
      })
    ).toBe(true);
  });

  it("is false for a single home stall without switch", () => {
    expect(
      computeStallAllAccess({
        role: "pos",
        canSwitchStall: false,
        assignedMainStorage: false,
      })
    ).toBe(false);
  });

  it("keeps super_admin and Main Storage as all-access", () => {
    expect(
      computeStallAllAccess({
        role: "super_admin",
        canSwitchStall: false,
        assignedMainStorage: false,
      })
    ).toBe(true);
    expect(
      computeStallAllAccess({
        role: "pos",
        canSwitchStall: false,
        assignedMainStorage: true,
      })
    ).toBe(true);
  });
});

describe("isSellStallAllowed", () => {
  it("allows any stall when can_switch_stall is on", () => {
    expect(
      isSellStallAllowed({
        warehouseId: "w-2",
        assignedIds: ["w-1"],
        canSwitchStall: true,
        isUnscoped: false,
      })
    ).toBe(true);
  });

  it("rejects a stall outside placement when switch is off", () => {
    expect(
      isSellStallAllowed({
        warehouseId: "w-2",
        assignedIds: ["w-1"],
        canSwitchStall: false,
        isUnscoped: false,
      })
    ).toBe(false);
  });
});
