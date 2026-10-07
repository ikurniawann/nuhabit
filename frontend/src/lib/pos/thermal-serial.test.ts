import { describe, expect, it } from "vitest";
import { isHandheldClient } from "@/lib/pos/thermal-serial";

describe("isHandheldClient", () => {
  it("detects Android tablet and phone", () => {
    expect(
      isHandheldClient(
        "Mozilla/5.0 (Linux; Android 13; SM-X110) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(true);
    expect(
      isHandheldClient(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
  });

  it("detects iPadOS desktop UA spoof", () => {
    expect(
      isHandheldClient(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        { platform: "MacIntel", maxTouchPoints: 5 },
      ),
    ).toBe(true);
  });

  it("allows desktop laptop Chrome", () => {
    expect(
      isHandheldClient(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        { platform: "Win32", maxTouchPoints: 0 },
      ),
    ).toBe(false);
    expect(
      isHandheldClient(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        { platform: "MacIntel", maxTouchPoints: 0 },
      ),
    ).toBe(false);
  });
});
