import { describe, expect, it } from "vitest";
import {
  computePosAccountingAmounts,
  mapPaymentMethodToSaleEvent,
  toJournalEntryDate,
} from "@/lib/pos/accounting-amounts";

describe("computePosAccountingAmounts", () => {
  it("builds TOTAL from subtotal - discount + tax + SC + other", () => {
    const amounts = computePosAccountingAmounts({
      subtotal: 100_000,
      discount_amount: 10_000,
      tax_amount: 9_000,
      service_charge_amount: 5_000,
      other_charges_amount: 1_000,
    });
    expect(amounts.SUBTOTAL).toBe(100_000);
    expect(amounts.DISCOUNT).toBe(10_000);
    expect(amounts.TAX).toBe(9_000);
    expect(amounts.SERVICE_CHARGE).toBe(6_000);
    expect(amounts.TOTAL).toBe(105_000);
    expect(amounts.PAID).toBe(105_000);
  });

  it("uses explicit total and COGS snapshot", () => {
    const amounts = computePosAccountingAmounts({
      subtotal: 50,
      discount_amount: 0,
      tax_amount: 5,
      total_amount: 55,
      amount_paid: 60,
      cogs: 18.456,
    });
    expect(amounts.TOTAL).toBe(55);
    expect(amounts.PAID).toBe(60);
    expect(amounts.COGS).toBe(18.46);
  });

  it("ignores negative values", () => {
    const amounts = computePosAccountingAmounts({
      subtotal: -10,
      discount_amount: -5,
      tax_amount: 0,
    });
    expect(amounts.SUBTOTAL).toBe(0);
    expect(amounts.DISCOUNT).toBe(0);
    expect(amounts.TOTAL).toBe(0);
  });
});

describe("toJournalEntryDate", () => {
  it("keeps ISO date strings and formats Date/timestamptz as YYYY-MM-DD JKT", () => {
    expect(toJournalEntryDate("2026-08-09")).toBe("2026-08-09");
    expect(toJournalEntryDate("2026-08-09T10:15:00.000+07:00")).toBe("2026-08-09");
    expect(toJournalEntryDate(new Date("2026-08-09T01:00:00+07:00"))).toBe("2026-08-09");
  });

  it("does not slice Date.toString() into invalid Postgres dates", () => {
    const value = new Date("2026-08-09T08:30:00+07:00");
    expect(String(value).slice(0, 10)).toMatch(/^[A-Za-z]{3} /);
    expect(toJournalEntryDate(value)).toBe("2026-08-09");
  });
});

describe("mapPaymentMethodToSaleEvent", () => {
  it("maps known POS methods to sale events", () => {
    expect(mapPaymentMethodToSaleEvent("cash")).toBe("POS_SALE_CASH");
    expect(mapPaymentMethodToSaleEvent("qris")).toBe("POS_SALE_QRIS");
    expect(mapPaymentMethodToSaleEvent("debit")).toBe("POS_SALE_DEBIT");
    expect(mapPaymentMethodToSaleEvent("credit")).toBe("POS_SALE_CREDIT");
    expect(mapPaymentMethodToSaleEvent("credit_card")).toBe("POS_SALE_CREDIT");
    expect(mapPaymentMethodToSaleEvent("ark_coin")).toBe("POS_SALE_ARK_COIN");
    expect(mapPaymentMethodToSaleEvent("gift_card")).toBe("POS_SALE_GIFT_CARD");
  });

  it("skips NFC tab explicitly and unknown/empty methods", () => {
    expect(mapPaymentMethodToSaleEvent("nfc_tab")).toBe("SKIP_NFC_TAB");
    expect(mapPaymentMethodToSaleEvent(null)).toBeNull();
    expect(mapPaymentMethodToSaleEvent("")).toBeNull();
    expect(mapPaymentMethodToSaleEvent("bitcoin")).toBeNull();
  });
});
