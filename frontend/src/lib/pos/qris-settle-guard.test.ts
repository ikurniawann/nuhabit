import { describe, expect, it } from "vitest";
import { assertQrisSaleMaySettle } from "./qris-settle-guard";

describe("assertQrisSaleMaySettle", () => {
  it("allows non-QRIS tenders", () => {
    expect(
      assertQrisSaleMaySettle({
        paymentMethod: "cash",
        xenditQrId: null,
        alreadyUsedByPaidOrder: false,
      })
    ).toEqual({ ok: true });
  });

  it("rejects QRIS without a Xendit id — Confirm during QR create must not settle", () => {
    expect(
      assertQrisSaleMaySettle({
        paymentMethod: "qris",
        xenditQrId: null,
        xenditExternalId: null,
        alreadyUsedByPaidOrder: false,
      })
    ).toEqual({ ok: false, message: "Menunggu pembayaran QRIS" });
  });

  it("rejects a QR that already settled another paid order", () => {
    expect(
      assertQrisSaleMaySettle({
        paymentMethod: "qris",
        xenditQrId: "qr_old",
        alreadyUsedByPaidOrder: true,
      })
    ).toEqual({ ok: false, message: "QRIS ini sudah dipakai transaksi lain" });
  });

  it("allows a fresh QRIS id that is not yet bound to a paid order", () => {
    expect(
      assertQrisSaleMaySettle({
        paymentMethod: "qris",
        xenditQrId: "qr_new",
        xenditExternalId: "pos-abc",
        alreadyUsedByPaidOrder: false,
      })
    ).toEqual({ ok: true });
  });
});
