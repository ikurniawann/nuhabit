import { describe, expect, it } from "vitest";
import { parseBridgeMessage } from "./parse-bridge-message";

describe("parseBridgeMessage", () => {
  it("accepts legacy card messages", () => {
    expect(parseBridgeMessage(JSON.stringify({ type: "card", uid: "04A1B2C3" }))).toEqual({
      kind: "card",
      uid: "04A1B2C3",
    });
  });

  it("accepts desktop bridge scan messages", () => {
    expect(parseBridgeMessage(JSON.stringify({ type: "scan", uid: "04A1B2C3" }))).toEqual({
      kind: "card",
      uid: "04A1B2C3",
    });
  });

  it("preserves reader announcements without treating them as scans", () => {
    expect(parseBridgeMessage(JSON.stringify({ type: "reader", name: "ACS ACR1555U" }))).toEqual({
      kind: "reader",
      name: "ACS ACR1555U",
    });
  });

  it("ignores malformed and non-scan bridge messages", () => {
    expect(parseBridgeMessage("{")).toEqual({ kind: "ignore" });
    expect(parseBridgeMessage(JSON.stringify({ type: "hello" }))).toEqual({ kind: "ignore" });
    expect(parseBridgeMessage(JSON.stringify({ type: "scan" }))).toEqual({ kind: "ignore" });
  });
});
