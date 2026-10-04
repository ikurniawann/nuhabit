import { describe, expect, it } from "vitest";
import { resolveTableBoardStatus } from "@/lib/pos/tables/table-board-status";

describe("resolveTableBoardStatus", () => {
  it("returns available when idle", () => {
    expect(resolveTableBoardStatus({ tableStatus: "available" })).toBe(
      "available"
    );
  });

  it("keeps reserved/maintenance when idle", () => {
    expect(resolveTableBoardStatus({ tableStatus: "reserved" })).toBe("reserved");
    expect(resolveTableBoardStatus({ tableStatus: "maintenance" })).toBe(
      "maintenance"
    );
  });

  it("returns occupied for active unpaid order", () => {
    expect(
      resolveTableBoardStatus({
        tableStatus: "available",
        activeOrders: [{ payment_status: "unpaid", pre_settled_at: null }],
      })
    ).toBe("occupied");
  });

  it("returns billing when pre-settled", () => {
    expect(
      resolveTableBoardStatus({
        activeOrders: [
          {
            payment_status: "unpaid",
            pre_settled_at: "2026-07-12T08:00:00.000Z",
          },
        ],
      })
    ).toBe("billing");
  });

  it("active order wins over reserved master status", () => {
    expect(
      resolveTableBoardStatus({
        tableStatus: "reserved",
        activeOrders: [{ pre_settled_at: null }],
      })
    ).toBe("occupied");
  });

  it("is occupied when any unpaid order exists", () => {
    expect(
      resolveTableBoardStatus({
        activeOrders: [{ payment_status: "unpaid" }, { payment_status: "paid" }],
      })
    ).toBe("occupied");
  });

  it("is billing when any active order is pre-settled", () => {
    expect(
      resolveTableBoardStatus({
        activeOrders: [
          { payment_status: "unpaid", pre_settled_at: null },
          {
            payment_status: "unpaid",
            pre_settled_at: "2026-08-15T10:00:00.000Z",
          },
        ],
      })
    ).toBe("billing");
  });

  it("stays available when only paid orders remain", () => {
    expect(
      resolveTableBoardStatus({
        tableStatus: "occupied",
        activeOrders: [{ payment_status: "paid" }],
      })
    ).toBe("available");
  });
});
