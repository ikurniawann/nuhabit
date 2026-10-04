import { describe, expect, it } from "vitest";
import { parseUidFromTransmit } from "./pcsc-uid";

describe("parseUidFromTransmit", () => {
  it("parses UID bytes before SW 90 00", () => {
    expect(parseUidFromTransmit(Buffer.from([0x04, 0xa1, 0xb2, 0xc3, 0x90, 0x00]))).toBe(
      "04A1B2C3"
    );
  });

  it("returns null when status word is not success", () => {
    expect(parseUidFromTransmit(Buffer.from([0x04, 0x6a, 0x81]))).toBeNull();
  });

  it("returns null for empty payload", () => {
    expect(parseUidFromTransmit(Buffer.from([0x90, 0x00]))).toBeNull();
  });
});
