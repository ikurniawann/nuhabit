import { describe, expect, test } from "vitest";
import {
  calculateBillCharges,
  DEFAULT_BILLING_CHARGES,
  profileScopeLabel,
  resolveEnabledOptionalCodes,
  serviceToggleLabel,
  taxToggleLabel,
  type BillingCharge,
} from "./billing-settings";

describe("calculateBillCharges", () => {
  test("no optional codes → no tax even if TAX enabled optional", () => {
    const result = calculateBillCharges({
      subtotalAfterDiscount: 100_000,
      charges: DEFAULT_BILLING_CHARGES,
      enabledOptionalCodes: [],
    });
    expect(result.tax_amount).toBe(0);
    expect(result.total).toBe(100_000);
    expect(result.breakdown).toEqual([]);
  });

  test("TAX optional enabled → 10% of subtotal", () => {
    const result = calculateBillCharges({
      subtotalAfterDiscount: 100_000,
      charges: DEFAULT_BILLING_CHARGES,
      enabledOptionalCodes: ["TAX"],
    });
    expect(result.tax_amount).toBe(10_000);
    expect(result.total).toBe(110_000);
    // rate + calc_method ikut di-snapshot supaya struk bisa mencetak "Tax (10%)"
    expect(result.breakdown).toEqual([
      { code: "TAX", name: "Tax", kind: "tax", amount: 10_000, rate: 10, calc_method: "percent" },
    ]);
  });

  test("service + fee uniqcode + tax on subtotal_plus_fees", () => {
    const charges: BillingCharge[] = [
      {
        code: "SERVICE",
        name: "Service",
        charge_kind: "service",
        calc_method: "percent",
        rate: 5,
        amount: 0,
        apply_order: 10,
        is_enabled: true,
        is_optional: false,
        base: "subtotal_after_discount",
      },
      {
        code: "PACK",
        name: "Packaging",
        charge_kind: "fee",
        calc_method: "fixed",
        rate: 0,
        amount: 2000,
        apply_order: 20,
        is_enabled: true,
        is_optional: false,
        base: "subtotal_after_discount",
      },
      {
        code: "TAX",
        name: "Tax",
        charge_kind: "tax",
        calc_method: "percent",
        rate: 10,
        amount: 0,
        apply_order: 30,
        is_enabled: true,
        is_optional: false,
        base: "subtotal_plus_fees",
      },
    ];

    const result = calculateBillCharges({
      subtotalAfterDiscount: 100_000,
      charges,
    });

    // service 5_000 + pack 2_000 → running 107_000; tax 10% of 107_000 = 10_700
    expect(result.service_charge_amount).toBe(5_000);
    expect(result.other_charges_amount).toBe(2_000);
    expect(result.tax_amount).toBe(10_700);
    expect(result.total).toBe(117_700);
  });

  test("rounding nearest 100", () => {
    const charges: BillingCharge[] = [
      {
        code: "TAX",
        name: "Tax",
        charge_kind: "tax",
        calc_method: "percent",
        rate: 10,
        amount: 0,
        apply_order: 10,
        is_enabled: true,
        is_optional: false,
        base: "subtotal_after_discount",
      },
      {
        code: "ROUND",
        name: "Rounding",
        charge_kind: "rounding",
        calc_method: "round_nearest",
        rate: 100,
        amount: 0,
        apply_order: 90,
        is_enabled: true,
        is_optional: false,
        base: "subtotal_plus_fees",
      },
    ];

    // 10_050 + 10% = 11_055 → nearest 100 = 11_100 (+45)
    const result = calculateBillCharges({
      subtotalAfterDiscount: 10_050,
      charges,
    });
    expect(result.tax_amount).toBe(1_005);
    expect(result.rounding_adjustment).toBe(45);
    expect(result.other_charges_amount).toBe(45);
    expect(result.total).toBe(11_100);
  });
});

describe("resolveEnabledOptionalCodes", () => {
  test("TAX follows includeTax; SERVICE follows includeService; other optionals stay on", () => {
    const charges: BillingCharge[] = [
      ...DEFAULT_BILLING_CHARGES.map((c) =>
        c.code === "SERVICE" ? { ...c, is_enabled: true, rate: 5 } : c
      ),
      {
        code: "PACK",
        name: "Packaging",
        charge_kind: "fee",
        calc_method: "fixed",
        rate: 0,
        amount: 2000,
        apply_order: 50,
        is_enabled: true,
        is_optional: true,
        base: "subtotal_after_discount",
      },
    ];
    expect(resolveEnabledOptionalCodes(charges, false, true)).toEqual([
      "SERVICE",
      "PACK",
    ]);
    expect(resolveEnabledOptionalCodes(charges, true, true)).toEqual([
      "TAX",
      "SERVICE",
      "PACK",
    ]);
    expect(resolveEnabledOptionalCodes(charges, true, false)).toEqual([
      "TAX",
      "PACK",
    ]);
  });
});

describe("taxToggleLabel", () => {
  test("formats optional percent tax", () => {
    expect(taxToggleLabel(DEFAULT_BILLING_CHARGES)).toBe("Tax (10%)");
  });
});

describe("serviceToggleLabel", () => {
  test("formats optional percent service when enabled", () => {
    const charges = DEFAULT_BILLING_CHARGES.map((c) =>
      c.code === "SERVICE" ? { ...c, is_enabled: true, rate: 5 } : c
    );
    expect(serviceToggleLabel(charges)).toBe("Service Charge (5%)");
  });

  test("null when service disabled", () => {
    expect(serviceToggleLabel(DEFAULT_BILLING_CHARGES)).toBeNull();
  });
});

describe("profileScopeLabel", () => {
  test("returns Indonesian labels", () => {
    expect(profileScopeLabel("system")).toBe("Default sistem");
    expect(profileScopeLabel("branch")).toBe("Default cabang");
    expect(profileScopeLabel("stall")).toBe("Override stall");
  });
});
