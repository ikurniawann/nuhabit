import { describe, expect, it } from "vitest";
import {
  buildQrImageUrl,
  isXenditQrPaid,
  parseXenditQrWebhook,
  verifyXenditWebhookToken,
  xenditAmountMatches,
} from "./xendit";

describe("verifyXenditWebhookToken", () => {
  it("menolak semua callback bila token belum dikonfigurasi (fail closed)", () => {
    expect(verifyXenditWebhookToken(null, null)).toBe(false);
    expect(verifyXenditWebhookToken("abc", null)).toBe(false);
    expect(verifyXenditWebhookToken("", "")).toBe(false);
  });

  it("requires match when configured", () => {
    expect(verifyXenditWebhookToken("tok", "tok")).toBe(true);
    expect(verifyXenditWebhookToken(" tok ", "tok")).toBe(true);
    expect(verifyXenditWebhookToken("wrong", "tok")).toBe(false);
    expect(verifyXenditWebhookToken(null, "tok")).toBe(false);
  });
});

describe("xenditAmountMatches", () => {
  it("nominal sama (toleransi pembulatan) diterima", () => {
    expect(xenditAmountMatches("50000.00", 50000)).toBe(true);
    expect(xenditAmountMatches(50000.4, 50000)).toBe(true);
  });

  it("nominal beda atau callback tanpa nominal ditolak", () => {
    expect(xenditAmountMatches(50000, 1000)).toBe(false);
    expect(xenditAmountMatches(50000, 0)).toBe(false);
    expect(xenditAmountMatches(null, 50000)).toBe(false);
    expect(xenditAmountMatches("abc", 50000)).toBe(false);
  });
});

describe("parseXenditQrWebhook", () => {
  it("detects paid qr.payment payload", () => {
    const parsed = parseXenditQrWebhook({
      event: "qr.payment",
      data: {
        id: "qrpy_1",
        qr_id: "qr_abc",
        reference_id: "topup_xyz",
        status: "SUCCEEDED",
        amount: 50000,
      },
    });
    expect(parsed.paid).toBe(true);
    expect(parsed.qrId).toBe("qr_abc");
    expect(parsed.referenceId).toBe("topup_xyz");
    expect(parsed.amount).toBe(50000);
  });

  it("ignores non-paid status", () => {
    const parsed = parseXenditQrWebhook({
      data: { status: "PENDING", qr_id: "qr_1" },
    });
    expect(parsed.paid).toBe(false);
  });
});

describe("isXenditQrPaid", () => {
  it("detects paid status on the QR itself", () => {
    expect(isXenditQrPaid({ status: "SUCCEEDED" })).toBe(true);
    expect(isXenditQrPaid({ payment_status: "COMPLETED" })).toBe(true);
  });

  it("detects a paid payment in list payloads", () => {
    expect(
      isXenditQrPaid({
        payments: [{ id: "qrpy_1", status: "SUCCEEDED" }],
      })
    ).toBe(true);
    expect(
      isXenditQrPaid({
        data: [{ id: "qrpy_1", status: "COMPLETED" }],
      })
    ).toBe(true);
  });

  it("does not treat inactive or pending QR as paid", () => {
    expect(isXenditQrPaid({ status: "ACTIVE" })).toBe(false);
    expect(isXenditQrPaid({ status: "INACTIVE" })).toBe(false);
    expect(isXenditQrPaid({ status: "PENDING" })).toBe(false);
    expect(isXenditQrPaid({ payments: [{ status: "PENDING" }] })).toBe(false);
  });
});

describe("buildQrImageUrl", () => {
  it("encodes qr string", () => {
    const url = buildQrImageUrl("000201");
    expect(url).toContain("create-qr-code");
    expect(url).toContain("000201");
  });
});
