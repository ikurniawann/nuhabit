/**
 * Definisi kolom & konversi form Pengaturan Payroll (payroll_settings +
 * payroll_tax_config). Kolom kosong = pakai default server, tidak dikirim.
 */

export interface FieldDef {
  key: string;
  label: string;
  suffix?: string;
}

export const BPJS_TK_FIELDS: FieldDef[] = [
  { key: "bpjs_tk_jht_employee", label: "JHT Karyawan", suffix: "%" },
  { key: "bpjs_tk_jht_employer", label: "JHT Perusahaan", suffix: "%" },
  { key: "bpjs_tk_jp_employee", label: "JP Karyawan", suffix: "%" },
  { key: "bpjs_tk_jp_employer", label: "JP Perusahaan", suffix: "%" },
  { key: "bpjs_tk_jkk", label: "JKK (Perusahaan)", suffix: "%" },
  { key: "bpjs_tk_jkm", label: "JKM (Perusahaan)", suffix: "%" },
];

export const BPJS_KES_FIELDS: FieldDef[] = [
  { key: "bpjs_kes_employee", label: "Karyawan", suffix: "%" },
  { key: "bpjs_kes_employer", label: "Perusahaan", suffix: "%" },
  { key: "bpjs_kes_max_upah", label: "Batas Upah Maks", suffix: "Rp" },
];

export const TAPERA_FIELDS: FieldDef[] = [
  { key: "tapera_employee", label: "Karyawan", suffix: "%" },
  { key: "tapera_employer", label: "Perusahaan", suffix: "%" },
];

export const LAINNYA_FIELDS: FieldDef[] = [
  { key: "overtime_multiplier", label: "Pengali Lembur (hari kerja)", suffix: "×" },
  // EPIC-036 Fase F — PP 35/2021 membedakan tarif lembur hari libur resmi.
  { key: "overtime_multiplier_holiday", label: "Pengali Lembur (hari libur)", suffix: "×" },
  { key: "overtime_hourly_divisor", label: "Pembagi Upah/Jam Lembur", suffix: "std 173" },
  { key: "payroll_day", label: "Tanggal Gajian", suffix: "tgl" },
  { key: "thr_eligible_months", label: "Min. Bulan Kerja THR", suffix: "bln" },
];

export const LOAN_FIELDS: FieldDef[] = [
  { key: "loan_max_installment_percent", label: "Cicilan Maks dari Gaji Pokok", suffix: "%" },
  { key: "loan_max_active_per_employee", label: "Maks Pinjaman Aktif/Karyawan", suffix: "buah" },
];

export const LATE_MODE_OPTIONS = [
  { value: "off", label: "Nonaktif (tanpa potongan)" },
  { value: "per_minute", label: "Per menit keterlambatan" },
  { value: "flat", label: "Flat per kejadian terlambat" },
];

export const PTKP_FIELDS: FieldDef[] = [
  { key: "ptkp_tk_0", label: "TK/0", suffix: "Rp" },
  { key: "ptkp_tk_1", label: "TK/1", suffix: "Rp" },
  { key: "ptkp_tk_2", label: "TK/2", suffix: "Rp" },
  { key: "ptkp_tk_3", label: "TK/3", suffix: "Rp" },
  { key: "ptkp_k_0", label: "K/0", suffix: "Rp" },
  { key: "ptkp_k_1", label: "K/1", suffix: "Rp" },
  { key: "ptkp_k_2", label: "K/2", suffix: "Rp" },
  { key: "ptkp_k_3", label: "K/3", suffix: "Rp" },
];

export const BRACKET_FIELDS: FieldDef[] = [
  { key: "bracket_1_limit", label: "Batas Lapisan 1", suffix: "Rp" },
  { key: "bracket_1_rate", label: "Tarif Lapisan 1", suffix: "%" },
  { key: "bracket_2_limit", label: "Batas Lapisan 2", suffix: "Rp" },
  { key: "bracket_2_rate", label: "Tarif Lapisan 2", suffix: "%" },
  { key: "bracket_3_limit", label: "Batas Lapisan 3", suffix: "Rp" },
  { key: "bracket_3_rate", label: "Tarif Lapisan 3", suffix: "%" },
  { key: "bracket_4_limit", label: "Batas Lapisan 4", suffix: "Rp" },
  { key: "bracket_4_rate", label: "Tarif Lapisan 4", suffix: "%" },
  { key: "bracket_5_rate", label: "Tarif Lapisan 5", suffix: "%" },
  { key: "jabatan_expense_percentage", label: "Biaya Jabatan", suffix: "%" },
  { key: "jabatan_expense_max", label: "Biaya Jabatan Maks/Thn", suffix: "Rp" },
];

export const SETTINGS_KEYS = [
  ...[
    ...BPJS_TK_FIELDS,
    ...BPJS_KES_FIELDS,
    ...TAPERA_FIELDS,
    ...LAINNYA_FIELDS,
    ...LOAN_FIELDS,
  ].map((f) => f.key),
  "late_deduction_mode",
  "late_deduction_amount",
];

/** Kolom pengaturan bertipe teks — dikirim apa adanya, bukan angka. */
const STRING_SETTING_KEYS = new Set(["late_deduction_mode"]);

export const TAX_KEYS = [...PTKP_FIELDS, ...BRACKET_FIELDS].map((f) => f.key);

export type FormState = Record<string, string>;

export function rowToFormState(
  row: Record<string, unknown> | null,
  keys: string[]
): FormState {
  const state: FormState = {};
  for (const key of keys) {
    const value = row?.[key];
    state[key] = value === null || value === undefined ? "" : String(value);
  }
  return state;
}

export function formStateToPayload(state: FormState): Record<string, number | string> {
  const payload: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value === "") continue;
    if (STRING_SETTING_KEYS.has(key)) {
      payload[key] = value;
      continue;
    }
    const n = Number(value);
    if (Number.isFinite(n)) payload[key] = n;
  }
  return payload;
}
