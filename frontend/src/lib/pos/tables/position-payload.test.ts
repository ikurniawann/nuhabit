import { describe, expect, it } from "vitest";
import { parsePositionPayload } from "@/lib/pos/tables/position-payload";

describe("parsePositionPayload", () => {
  it("accepts valid numbers and clamps", () => {
    expect(parsePositionPayload({ pos_x: -1, pos_y: 200 })).toEqual({
      data: { pos_x: 0, pos_y: 100 },
    });
  });

  it("rejects missing fields", () => {
    const result = parsePositionPayload({ pos_x: 10 });
    expect("error" in result).toBe(true);
  });

  it("rejects non-numeric", () => {
    const result = parsePositionPayload({ pos_x: "a", pos_y: 1 });
    expect("error" in result).toBe(true);
  });
});
