import { describe, it, expect } from "vitest";
import { SETTINGS_KEYS, TAX_KEYS, formStateToPayload, rowToFormState } from "./ui-settings-form";

describe("rowToFormState", () => {
  it("stringifies known keys and blanks missing ones", () => {
    const state = rowToFormState({ bpjs_kes_employee: 1, payroll_day: "25", extra: 9 }, [
      "bpjs_kes_employee",
      "payroll_day",
      "tapera_employee",
    ]);
    expect(state).toEqual({ bpjs_kes_employee: "1", payroll_day: "25", tapera_employee: "" });
  });

  it("handles a missing row", () => {
    expect(rowToFormState(null, ["a"])).toEqual({ a: "" });
  });
});

describe("formStateToPayload", () => {
  it("drops empty values, converts numbers, keeps the late mode text", () => {
    expect(
      formStateToPayload({
        bpjs_kes_employee: "1.5",
        tapera_employee: "",
        late_deduction_mode: "per_minute",
        payroll_day: "abc",
      })
    ).toEqual({ bpjs_kes_employee: 1.5, late_deduction_mode: "per_minute" });
  });
});

describe("key lists", () => {
  it("include the late deduction settings and tax brackets", () => {
    expect(SETTINGS_KEYS).toContain("late_deduction_mode");
    expect(SETTINGS_KEYS).toContain("late_deduction_amount");
    expect(TAX_KEYS).toContain("ptkp_k_3");
    expect(TAX_KEYS).toContain("jabatan_expense_max");
  });
});
