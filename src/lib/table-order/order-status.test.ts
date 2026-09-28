import { describe, expect, it } from "vitest";
import {
  isOrderActive,
  orderProgressStep,
  orderStatusText,
  orderTypeText,
  paymentFlowFrom,
  paymentMethodText,
  paymentStatusText,
} from "./order-status";

describe("orderProgressStep", () => {
  it("memetakan status POS ke langkah progres pemesan", () => {
    expect(orderProgressStep(undefined)).toBe(0);
    expect(orderProgressStep("pending")).toBe(0);
    expect(orderProgressStep("confirmed")).toBe(1);
    expect(orderProgressStep("PREPARING")).toBe(2);
    expect(orderProgressStep("ready")).toBe(3);
    expect(orderProgressStep("served")).toBe(4);
    expect(orderProgressStep("completed")).toBe(4);
  });

  it("dibatalkan/void/merged → -1 dan tidak aktif", () => {
    for (const status of ["cancelled", "voided", "merged"]) {
      expect(orderProgressStep(status)).toBe(-1);
      expect(isOrderActive(status)).toBe(false);
    }
    expect(isOrderActive("preparing")).toBe(true);
    expect(isOrderActive("completed")).toBe(false);
  });
});

describe("teks status", () => {
  it("bahasa pemesan utk status, pembayaran, metode, dan tipe", () => {
    expect(orderStatusText("ready")).toBe("Siap diantar");
    expect(orderStatusText("aneh")).toBe("aneh");
    expect(paymentStatusText(null)).toBe("Belum dibayar");
    expect(paymentStatusText("paid")).toBe("Sudah dibayar");
    expect(paymentMethodText("ark_coin")).toBe("ARK Coin");
    expect(paymentMethodText("")).toBe("—");
    expect(orderTypeText("takeaway")).toBe("Bawa pulang");
    expect(orderTypeText(null)).toBe("Makan di tempat");
  });
});

describe("paymentFlowFrom & Static QRIS", () => {
  it("membaca penanda payment= di special_requests; tanpa penanda → payment_method → cashier", () => {
    expect(paymentFlowFrom("Self-service table order WIT-BDG; payment=static_qris")).toBe("static_qris");
    expect(paymentFlowFrom("Self-service table order T1; payment=QRIS", "cash")).toBe("qris");
    expect(paymentFlowFrom(null, "cash")).toBe("cash");
    expect(paymentFlowFrom(undefined)).toBe("cashier");
  });

  it("label metode Static QRIS", () => {
    expect(paymentMethodText("static_qris")).toBe("Static QRIS");
  });
});
