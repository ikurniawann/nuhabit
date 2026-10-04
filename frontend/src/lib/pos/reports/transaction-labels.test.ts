import { describe, expect, it } from "vitest";
import {
  formatCompTypeLabel,
  formatKitchenStatusLabel,
  formatOrderTypeLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatReportStallLabel,
  formatSoldFromLabel,
  formatXenditPaymentLabel,
  formatXenditSettlementNote,
  isPaidPaymentStatus,
  isQrisPaymentMethod,
  resolveXenditExternalId,
} from "@/lib/pos/reports/transaction-labels";

describe("formatPaymentStatusLabel", () => {
  it("uses payment_status, not kitchen pending", () => {
    expect(formatPaymentStatusLabel("paid", "pending")).toBe("Lunas");
    expect(formatPaymentStatusLabel("unpaid", "pending")).toBe("Belum lunas");
  });

  it("treats completed kitchen as lunas when payment_status missing", () => {
    expect(formatPaymentStatusLabel(null, "completed")).toBe("Lunas");
  });
});

describe("formatPaymentMethodLabel", () => {
  it("maps POS codes to Indonesian labels", () => {
    expect(formatPaymentMethodLabel("qris")).toBe("QRIS");
    expect(formatPaymentMethodLabel("cash")).toBe("Tunai");
    expect(formatPaymentMethodLabel("credit")).toBe("Kartu");
  });

  it("prefers custom catalog name over cash/credit handler", () => {
    expect(
      formatPaymentMethodLabel("cash", {
        code: "transfer_bca",
        name: "Transfer BCA",
      })
    ).toBe("Transfer BCA");
    expect(
      formatPaymentMethodLabel("cash", {
        code: "cash",
        name: "Cash",
      })
    ).toBe("Tunai");
  });
});

describe("formatKitchenStatusLabel", () => {
  it("does not call kitchen pending unpaid", () => {
    expect(formatKitchenStatusLabel("pending")).toBe("Antrian dapur");
  });
});

describe("isPaidPaymentStatus", () => {
  it("is true for paid even if kitchen is pending", () => {
    expect(isPaidPaymentStatus("paid", "pending")).toBe(true);
  });
});

describe("formatOrderTypeLabel", () => {
  it("maps POS order types", () => {
    expect(formatOrderTypeLabel("dine_in")).toBe("Dine-in");
    expect(formatOrderTypeLabel("takeaway")).toBe("Takeaway");
  });
});

describe("formatSoldFromLabel", () => {
  it("maps sold_from", () => {
    expect(formatSoldFromLabel("central")).toBe("Kasir pusat");
    expect(formatSoldFromLabel("stall")).toBe("Kasir stall");
  });
});

describe("resolveXenditExternalId", () => {
  it("uses stored id only", () => {
    expect(
      resolveXenditExternalId({
        storedExternalId: "pos-chk-abc",
      })
    ).toBe("pos-chk-abc");
  });

  it("does not invent pos-{orderId} for stall QRIS", () => {
    expect(resolveXenditExternalId({})).toBeNull();
  });
});

describe("formatXenditSettlementNote", () => {
  it("shows Xendit as the settlement source", () => {
    expect(formatXenditSettlementNote()).toBe("Xendit");
  });
});

describe("formatXenditPaymentLabel", () => {
  it("does not treat settlement pending as failed pay", () => {
    expect(formatXenditPaymentLabel("paid", "pending")).toBe("Success");
    expect(isQrisPaymentMethod("qris")).toBe(true);
  });
});

describe("formatReportStallLabel", () => {
  it("hides raw UUID stall names", () => {
    expect(
      formatReportStallLabel({
        stall_name: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        stall_code: "FNB",
      })
    ).toBe("FNB");
    expect(formatReportStallLabel({ stall_name: "Sate", stall_code: "SAT" })).toBe(
      "Sate"
    );
  });
});

describe("formatCompTypeLabel", () => {
  it("maps known compliment types", () => {
    expect(formatCompTypeLabel("foc_comp")).toBe("FOC");
    expect(formatCompTypeLabel(null)).toBe("");
  });
});
