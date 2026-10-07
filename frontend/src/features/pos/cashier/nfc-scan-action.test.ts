import { describe, expect, it } from "vitest";
import { resolveCashierNfcAction } from "./nfc-scan-action";

describe("resolveCashierNfcAction", () => {
  it("asks to create when member is missing", () => {
    expect(
      resolveCashierNfcAction({
        memberFound: false,
        balance: 0,
        totalDue: 10000,
        enforceArkBalance: false,
      })
    ).toBe("create");
  });

  it("selects member when found outside payment", () => {
    expect(
      resolveCashierNfcAction({
        memberFound: true,
        balance: 1000,
        totalDue: 50000,
        enforceArkBalance: false,
      })
    ).toBe("select");
  });

  it("asks to top up when paying with insufficient ARK", () => {
    expect(
      resolveCashierNfcAction({
        memberFound: true,
        balance: 1000,
        totalDue: 50000,
        enforceArkBalance: true,
      })
    ).toBe("topup");
  });

  it("selects member when paying with enough ARK", () => {
    expect(
      resolveCashierNfcAction({
        memberFound: true,
        balance: 80000,
        totalDue: 50000,
        enforceArkBalance: true,
      })
    ).toBe("select");
  });
});
