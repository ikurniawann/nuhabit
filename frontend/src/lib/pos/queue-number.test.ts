import { describe, expect, it } from "vitest";
import {
  formatQueueNumber,
  shouldAllocateQueueNumber,
} from "@/lib/pos/queue-number";

describe("formatQueueNumber", () => {
  it("pads daily sequence to 3 digits", () => {
    expect(formatQueueNumber(1)).toBe("001");
    expect(formatQueueNumber(42)).toBe("042");
    expect(formatQueueNumber(128)).toBe("128");
  });

  it("floors decimals and never returns 000", () => {
    expect(formatQueueNumber(2.9)).toBe("002");
    expect(formatQueueNumber(0)).toBe("001");
    expect(formatQueueNumber(-4)).toBe("001");
  });
});

describe("shouldAllocateQueueNumber", () => {
  it("allocates only when missing", () => {
    expect(shouldAllocateQueueNumber(null)).toBe(true);
    expect(shouldAllocateQueueNumber(undefined)).toBe(true);
    expect(shouldAllocateQueueNumber("")).toBe(true);
    expect(shouldAllocateQueueNumber("  ")).toBe(true);
    expect(shouldAllocateQueueNumber("007")).toBe(false);
  });
});
