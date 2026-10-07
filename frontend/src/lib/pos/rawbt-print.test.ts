import { describe, expect, it } from "vitest";
import {
  buildRawBtIntentUrl,
  bytesToBase64,
  canUseRawBtPrint,
  isAndroidClient,
  printBytesViaRawBt,
} from "@/lib/pos/rawbt-print";

describe("isAndroidClient / canUseRawBtPrint", () => {
  it("detects Android tablets and phones", () => {
    const tablet =
      "Mozilla/5.0 (Linux; Android 13; SM-X110) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
    expect(isAndroidClient(tablet)).toBe(true);
    expect(canUseRawBtPrint(tablet)).toBe(true);
  });

  it("rejects desktop and iOS", () => {
    expect(
      isAndroidClient(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      canUseRawBtPrint(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe(false);
  });
});

describe("buildRawBtIntentUrl", () => {
  it("embeds base64 ESC/POS for RawBT package", () => {
    const bytes = Uint8Array.from([0x1b, 0x40, 0x41]);
    const url = buildRawBtIntentUrl(bytes);
    expect(url.startsWith("intent:base64,")).toBe(true);
    expect(url).toContain(bytesToBase64(bytes));
    expect(url).toContain("package=ru.a402d.rawbtprinter");
  });
});

describe("printBytesViaRawBt", () => {
  it("returns false on desktop (no Android UA path in jsdom)", () => {
    expect(printBytesViaRawBt(Uint8Array.from([0x1b, 0x40]))).toBe(false);
  });
});
