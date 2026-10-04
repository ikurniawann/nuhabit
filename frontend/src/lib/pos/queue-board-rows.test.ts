import { describe, expect, it } from "vitest";
import { uniqueQueueRows } from "@/lib/pos/queue-board-rows";

describe("uniqueQueueRows", () => {
  it("collapses three child orders with the same checkout_id into one row", () => {
    const rows = uniqueQueueRows([
      { id: "child-a", checkout_id: "chk-1", queue_number: "007" },
      { id: "child-b", checkout_id: "chk-1", queue_number: "007" },
      { id: "child-c", checkout_id: "chk-1", queue_number: "007" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("child-a");
    expect(rows[0]?.checkout_id).toBe("chk-1");
  });

  it("keeps a stall order without checkout_id as its own row", () => {
    const rows = uniqueQueueRows([
      { id: "stall-1", checkout_id: null, queue_number: "012" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("stall-1");
  });

  it("does not collapse two stall orders that lack checkout_id", () => {
    const rows = uniqueQueueRows([
      { id: "stall-1", checkout_id: null, queue_number: "012" },
      { id: "stall-2", checkout_id: undefined, queue_number: "013" },
    ]);

    expect(rows.map((row) => row.id)).toEqual(["stall-1", "stall-2"]);
  });
});
