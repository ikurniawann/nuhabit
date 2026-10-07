import { describe, expect, it } from "vitest";

import {
  canPickMergeDestination,
  canPickMoveDestination,
  canPickSeatDestination,
  canPickTransferDestination,
} from "./move-destination";

describe("canPickMoveDestination", () => {
  it("allows a different available table", () => {
    expect(
      canPickMoveDestination(
        { id: "t2", status: "available", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(true);
  });

  it("rejects the source table", () => {
    expect(
      canPickMoveDestination(
        { id: "t1", status: "available", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });

  it("allows occupied and billing so a table can hold multiple bills", () => {
    for (const status of ["occupied", "billing"]) {
      expect(
        canPickMoveDestination(
          { id: "t2", status, is_active: true },
          { sourceTableId: "t1" }
        )
      ).toBe(true);
    }
  });

  it("rejects reserved and maintenance", () => {
    for (const status of ["reserved", "maintenance"]) {
      expect(
        canPickMoveDestination(
          { id: "t2", status, is_active: true },
          { sourceTableId: "t1" }
        )
      ).toBe(false);
    }
  });

  it("rejects inactive tables", () => {
    expect(
      canPickMoveDestination(
        { id: "t2", status: "available", is_active: false },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });

  it("allows available when source has no table", () => {
    expect(
      canPickMoveDestination(
        { id: "t2", status: "available", is_active: true },
        { sourceTableId: null }
      )
    ).toBe(true);
  });
});

describe("canPickTransferDestination", () => {
  it("allows available and occupied/billing", () => {
    for (const status of ["available", "occupied", "billing"]) {
      expect(
        canPickTransferDestination(
          { id: "t2", status, is_active: true },
          { sourceTableId: "t1" }
        )
      ).toBe(true);
    }
  });

  it("rejects source, reserved, maintenance, inactive", () => {
    expect(
      canPickTransferDestination(
        { id: "t1", status: "available", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
    for (const status of ["reserved", "maintenance"]) {
      expect(
        canPickTransferDestination(
          { id: "t2", status, is_active: true },
          { sourceTableId: "t1" }
        )
      ).toBe(false);
    }
    expect(
      canPickTransferDestination(
        { id: "t2", status: "occupied", is_active: false },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });
});

describe("canPickMergeDestination", () => {
  it("allows occupied and billing only", () => {
    expect(
      canPickMergeDestination(
        { id: "t2", status: "occupied", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(true);
    expect(
      canPickMergeDestination(
        { id: "t2", status: "billing", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(true);
    expect(
      canPickMergeDestination(
        { id: "t2", status: "available", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });

  it("rejects source table", () => {
    expect(
      canPickMergeDestination(
        { id: "t1", status: "occupied", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });

  it("rejects a stall bill merging into a central or mixed destination", () => {
    expect(
      canPickMergeDestination(
        { id: "t2", status: "occupied", is_active: true },
        {
          sourceTableId: "t1",
          sourceBill: { sold_from: "stall", checkout_id: null },
          destOrders: [{ sold_from: "central", checkout_id: "chk-1" }],
        }
      )
    ).toBe(false);
    expect(
      canPickMergeDestination(
        { id: "t2", status: "occupied", is_active: true },
        {
          sourceTableId: "t1",
          sourceBill: { sold_from: "stall", checkout_id: null },
          destOrders: [
            { sold_from: "stall", checkout_id: null },
            { sold_from: "central", checkout_id: "chk-1" },
          ],
        }
      )
    ).toBe(false);
  });
});

describe("canPickSeatDestination", () => {
  it("keeps seating on available tables only", () => {
    expect(
      canPickSeatDestination(
        { id: "t2", status: "available", is_active: true },
        { sourceTableId: null }
      )
    ).toBe(true);
    expect(
      canPickSeatDestination(
        { id: "t2", status: "occupied", is_active: true },
        { sourceTableId: null }
      )
    ).toBe(false);
  });
});
