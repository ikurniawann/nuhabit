import { describe, expect, it } from "vitest";
import { filledPercent, slotTone, slotsLeftLabel, slotsLeftPitch } from "./slots";

describe("slots left (Member App)", () => {
  it("tingkat: penuh, slot terakhir, hampir penuh (≤3 atau ≤25%), tersedia", () => {
    expect(slotTone(0, 12)).toBe("full");
    expect(slotTone(-1, 12)).toBe("full");
    expect(slotTone(1, 12)).toBe("last");
    expect(slotTone(3, 12)).toBe("low");
    expect(slotTone(4, 12)).toBe("open");
    expect(slotTone(5, 20)).toBe("low");
    expect(slotTone(6, 20)).toBe("open");
    expect(slotTone(2, 2)).toBe("low");
  });

  it("label kartu & kalimat ajakan", () => {
    expect(slotsLeftLabel(8, 12)).toBe("8 slots left");
    expect(slotsLeftLabel(2, 12)).toBe("Only 2 slots left");
    expect(slotsLeftLabel(1, 12)).toBe("Last slot!");
    expect(slotsLeftLabel(0, 12)).toBe("Full · Join waitlist");
    expect(slotsLeftPitch(2, 12, 0)).toBe("Only 2 slots left — book now to lock in your spot.");
    expect(slotsLeftPitch(0, 12, 3)).toContain("3 on the waitlist");
    expect(slotsLeftPitch(9, 12, 0)).toBe("9 slots left of 12.");
  });

  it("persentase terisi untuk bar", () => {
    expect(filledPercent(12, 12)).toBe(0);
    expect(filledPercent(3, 12)).toBe(75);
    expect(filledPercent(0, 12)).toBe(100);
    expect(filledPercent(5, 0)).toBe(100);
  });
});
