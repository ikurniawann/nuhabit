/**
 * Logika form struktur gaji (tambah & edit). Input nominal ditampilkan dengan
 * pemisah ribuan ("5.000.000") dan dikirim ke API sebagai angka bulat.
 */

export const SALARY_AMOUNT_FIELDS = [
  "base_salary",
  "fixed_allowance",
  "variable_allowance",
  "transport_allowance",
  "meal_allowance",
  "housing_allowance",
  "loan_deduction",
  "other_deduction",
] as const;

export type SalaryAmountField = (typeof SALARY_AMOUNT_FIELDS)[number];

export interface SalaryFormState extends Record<SalaryAmountField, string> {
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled: boolean;
  bpjs_kes_enrolled: boolean;
  tapera_enrolled: boolean;
  notes: string;
}

export interface SalaryFormPayload extends Record<SalaryAmountField, number> {
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled: boolean;
  bpjs_kes_enrolled: boolean;
  tapera_enrolled: boolean;
  notes?: string;
}

/** Ambil digit saja dari ketikan pengguna: "Rp 1.250.000" → 1250000. */
export function parseRupiahInput(value: string): number {
  return parseInt(value.replace(/[^0-9]/g, ""), 10) || 0;
}

/** Format ketikan pengguna jadi "1.250.000". */
export function formatRupiahInput(value: string): string {
  return parseRupiahInput(value).toLocaleString("id-ID");
}

/** Nilai dari DB (numeric bisa datang sebagai "5000000.00") → teks input. */
function amountToInput(value: number | string | null | undefined): string {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString("id-ID");
}

export const EMPTY_SALARY_FORM: SalaryFormState = {
  base_salary: "",
  fixed_allowance: "0",
  variable_allowance: "0",
  transport_allowance: "0",
  meal_allowance: "0",
  housing_allowance: "0",
  loan_deduction: "0",
  other_deduction: "0",
  ptkp_status: "TK/0",
  is_taxable: true,
  bpjs_tk_enrolled: true,
  bpjs_kes_enrolled: true,
  tapera_enrolled: true,
  notes: "",
};

export interface SalaryRecordLike
  extends Partial<Record<SalaryAmountField, number | string | null>> {
  ptkp_status?: string | null;
  is_taxable?: boolean | null;
  bpjs_tk_enrolled?: boolean | null;
  bpjs_kes_enrolled?: boolean | null;
  tapera_enrolled?: boolean | null;
  notes?: string | null;
}

export function salaryToForm(data: SalaryRecordLike): SalaryFormState {
  const form = { ...EMPTY_SALARY_FORM };
  for (const field of SALARY_AMOUNT_FIELDS) form[field] = amountToInput(data[field]);
  if (!Number(data.base_salary)) form.base_salary = "";
  return {
    ...form,
    ptkp_status: data.ptkp_status || "TK/0",
    is_taxable: data.is_taxable ?? true,
    bpjs_tk_enrolled: data.bpjs_tk_enrolled ?? true,
    bpjs_kes_enrolled: data.bpjs_kes_enrolled ?? true,
    tapera_enrolled: data.tapera_enrolled ?? true,
    notes: data.notes || "",
  };
}

export function formToSalaryPayload(form: SalaryFormState): SalaryFormPayload {
  const amounts = Object.fromEntries(
    SALARY_AMOUNT_FIELDS.map((field) => [field, parseRupiahInput(form[field])])
  ) as Record<SalaryAmountField, number>;
  return {
    ...amounts,
    ptkp_status: form.ptkp_status,
    is_taxable: form.is_taxable,
    bpjs_tk_enrolled: form.bpjs_tk_enrolled,
    bpjs_kes_enrolled: form.bpjs_kes_enrolled,
    tapera_enrolled: form.tapera_enrolled,
    notes: form.notes,
  };
}
