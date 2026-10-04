import { describe, expect, it } from "vitest";
import { localDateStamp, nextSequentialCode, utcDateStamp } from "./item-codes";

describe("item-codes", () => {
  it("utcDateStamp memakai tanggal UTC", () => {
    expect(utcDateStamp(new Date("2026-10-04T23:30:00Z"))).toBe("20261004");
  });

  it("localDateStamp memakai tanggal lokal server", () => {
    expect(localDateStamp(new Date(2026, 0, 5, 8))).toBe("20260105");
  });

  it("nextSequentialCode menaikkan segmen terakhir", () => {
    expect(nextSequentialCode("PRD-20261004", "PRD-20261004-007", 3)).toBe("PRD-20261004-008");
    expect(nextSequentialCode("BHN-2026", "BHN-2026-0099", 4)).toBe("BHN-2026-0100");
  });

  it("nextSequentialCode mulai dari 1 tanpa kode terakhir berangka", () => {
    expect(nextSequentialCode("SUP-20261004", null, 3)).toBe("SUP-20261004-001");
    expect(nextSequentialCode("SUP-20261004", "SUP-20261004-X", 3)).toBe("SUP-20261004-001");
  });
});
