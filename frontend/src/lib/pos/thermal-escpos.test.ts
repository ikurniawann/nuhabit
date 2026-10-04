import { describe, expect, it } from "vitest";
import {
  centerPad,
  encodeEscPosLines,
  encodeEscPosText,
  formatReceiptRow,
  THERMAL_WIDTH,
} from "@/lib/pos/thermal-escpos";

describe("formatReceiptRow", () => {
  it("aligns left and right within the 80mm width (48 columns)", () => {
    expect(formatReceiptRow("TOTAL", "Rp 128.000")).toBe(`TOTAL${" ".repeat(33)}Rp 128.000`);
    expect(formatReceiptRow("TOTAL", "Rp 128.000").length).toBe(THERMAL_WIDTH);
  });
});

describe("centerPad", () => {
  it("pads short text so it sits in the middle of the line", () => {
    const out = centerPad("TITLE");
    expect(out.trim()).toBe("TITLE");
    expect(out.startsWith(" ")).toBe(true);
    // Left pad only (trailing spaces often stripped by printers)
    expect(out.length).toBe(Math.floor((THERMAL_WIDTH - 5) / 2) + 5);
  });
});

describe("encodeEscPosText", () => {
  it("starts with init and ends with cut", () => {
    const bytes = encodeEscPosText(["ARKIV", "TOTAL"]);
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00]);
    expect(Array.from(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
    expect(String.fromCharCode(...bytes.slice(5, 10))).toBe("ARKIV");
  });
});

describe("encodeEscPosLines", () => {
  it("space-pads centered lines instead of ESC a (RawBT-safe)", () => {
    const bytes = encodeEscPosLines([
      { text: "TITLE", align: "center" },
      { text: "ITEM", align: "left" },
    ]);
    const arr = Array.from(bytes);
    expect(arr.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00]);
    const padded = centerPad("TITLE");
    expect(String.fromCharCode(...arr.slice(5, 5 + padded.length))).toBe(padded);
    expect(arr[5 + padded.length]).toBe(0x0a);
    const itemStart = 5 + padded.length + 1;
    expect(String.fromCharCode(...arr.slice(itemStart, itemStart + 4))).toBe("ITEM");
  });
});
