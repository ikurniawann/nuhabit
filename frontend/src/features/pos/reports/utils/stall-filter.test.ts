import { describe, expect, it } from "vitest";
import { stallFilterValue } from "./stall-filter";

describe("stallFilterValue", () => {
  it("pilihan user menang; stall terkunci jadi default", () => {
    expect(stallFilterValue("w2", { stall_locked: true, filters: { warehouse_id: "w1" } })).toBe("w2");
    expect(stallFilterValue("", { stall_locked: true, filters: { warehouse_id: "w1" } })).toBe("w1");
    expect(stallFilterValue("", { stall_locked: false, filters: { warehouse_id: "w1" } })).toBe("");
    expect(stallFilterValue("", undefined)).toBe("");
  });
});
