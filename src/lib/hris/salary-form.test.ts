import { describe, it, expect } from "vitest";
import {
  EMPTY_SALARY_FORM,
  formToSalaryPayload,
  formatRupiahInput,
  parseRupiahInput,
  salaryToForm,
} from "./salary-form";

describe("parseRupiahInput / formatRupiahInput", () => {
  it("keeps digits only", () => {
    expect(parseRupiahInput("Rp 1.250.000")).toBe(1250000);
    expect(parseRupiahInput("")).toBe(0);
    expect(parseRupiahInput("abc")).toBe(0);
  });

  it("formats typed digits with thousand dots", () => {
    expect(formatRupiahInput("1250000")).toBe("1.250.000");
    expect(formatRupiahInput("1.2500")).toBe("12.500");
    expect(formatRupiahInput("")).toBe("0");
  });
});

describe("salaryToForm", () => {
  it("reads pg numeric strings without multiplying by 100", () => {
    const form = salaryToForm({ base_salary: "5000000.00", meal_allowance: "250000.00" });
    expect(form.base_salary).toBe("5.000.000");
    expect(form.meal_allowance).toBe("250.000");
    expect(formToSalaryPayload(form).base_salary).toBe(5000000);
  });

  it("leaves base salary empty when zero and defaults flags", () => {
    const form = salaryToForm({ base_salary: 0, ptkp_status: null, is_taxable: false });
    expect(form.base_salary).toBe("");
    expect(form.fixed_allowance).toBe("0");
    expect(form.ptkp_status).toBe("TK/0");
    expect(form.is_taxable).toBe(false);
    expect(form.bpjs_tk_enrolled).toBe(true);
    expect(form.notes).toBe("");
  });
});

describe("formToSalaryPayload", () => {
  it("converts every amount and keeps flags", () => {
    const payload = formToSalaryPayload({
      ...EMPTY_SALARY_FORM,
      base_salary: "7.500.000",
      loan_deduction: "100.000",
      ptkp_status: "K/1",
      tapera_enrolled: false,
      notes: "catatan",
    });
    expect(payload).toEqual({
      base_salary: 7500000,
      fixed_allowance: 0,
      variable_allowance: 0,
      transport_allowance: 0,
      meal_allowance: 0,
      housing_allowance: 0,
      loan_deduction: 100000,
      other_deduction: 0,
      ptkp_status: "K/1",
      is_taxable: true,
      bpjs_tk_enrolled: true,
      bpjs_kes_enrolled: true,
      tapera_enrolled: false,
      notes: "catatan",
    });
  });
});
