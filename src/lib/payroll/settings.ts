/**
 * Pengaturan payroll (EPIC-008): baris tunggal hris.payroll_settings dan
 * hris.payroll_tax_config per tahun pajak. Sumber kebenaran tarif BPJS/PPh21
 * yang dibaca config.ts saat kalkulasi.
 */

import { z } from "zod";
import type { PgClient } from "@/lib/pg/create-client";

const percent = z.coerce.number().min(0).max(100);
const rupiah = z.coerce.number().min(0);

/**
 * Bracket PPh21 disimpan sebagai batas KUMULATIF: nilai yang dikirim
 * bersamaan harus naik ketat, kalau tidak lebar bracket jadi nol dan
 * pajak salah hitung diam-diam.
 */
function refineIncreasingLimits(
  keys: string[],
  data: Record<string, unknown>,
  ctx: z.RefinementCtx
) {
  let prevKey: string | null = null;
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    if (prevKey !== null) {
      const prev = data[prevKey];
      if (prev !== undefined && Number(value) <= Number(prev)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} harus lebih besar dari ${prevKey}`,
        });
      }
    }
    prevKey = key;
  }
}

const settingsSchema = z.object({
  company_name: z.string().min(1).optional(),
  npwp: z.string().nullable().optional(),
  bpjs_tk_jht_employee: percent.optional(),
  bpjs_tk_jht_employer: percent.optional(),
  bpjs_tk_jp_employee: percent.optional(),
  bpjs_tk_jp_employer: percent.optional(),
  bpjs_tk_jkk: percent.optional(),
  bpjs_tk_jkm: percent.optional(),
  bpjs_kes_employee: percent.optional(),
  bpjs_kes_employer: percent.optional(),
  bpjs_kes_max_upah: z.coerce.number().positive().optional(),
  tapera_employee: percent.optional(),
  tapera_employer: percent.optional(),
  ptkp_tk_0: rupiah.optional(),
  ptkp_tk_1: rupiah.optional(),
  ptkp_tk_2: rupiah.optional(),
  ptkp_tk_3: rupiah.optional(),
  ptkp_k_0: rupiah.optional(),
  ptkp_k_1: rupiah.optional(),
  ptkp_k_2: rupiah.optional(),
  ptkp_k_3: rupiah.optional(),
  pph21_bracket_1: rupiah.optional(),
  pph21_bracket_2: rupiah.optional(),
  pph21_bracket_3: rupiah.optional(),
  pph21_bracket_4: rupiah.optional(),
  thr_eligible_months: z.coerce.number().int().min(0).max(24).optional(),
  thr_prorate: z.boolean().optional(),
  payroll_day: z.coerce.number().int().min(1).max(31).optional(),
  overtime_multiplier: z.coerce.number().min(0).max(10).optional(),
  overtime_multiplier_holiday: z.coerce.number().min(0).max(10).optional(),
  overtime_hourly_divisor: z.coerce.number().positive().max(1000).optional(),
  late_deduction_mode: z.enum(["off", "per_minute", "flat"]).optional(),
  late_deduction_amount: rupiah.optional(),
  loan_max_installment_percent: percent.optional(),
  loan_max_active_per_employee: z.coerce.number().int().min(1).max(10).optional(),
}).superRefine((data, ctx) =>
  refineIncreasingLimits(
    ["pph21_bracket_1", "pph21_bracket_2", "pph21_bracket_3", "pph21_bracket_4"],
    data,
    ctx
  )
);

const taxConfigSchema = z.object({
  tax_year: z.coerce.number().int().min(2000).max(2100),
  ptkp_tk_0: rupiah.optional(),
  ptkp_tk_1: rupiah.optional(),
  ptkp_tk_2: rupiah.optional(),
  ptkp_tk_3: rupiah.optional(),
  ptkp_k_0: rupiah.optional(),
  ptkp_k_1: rupiah.optional(),
  ptkp_k_2: rupiah.optional(),
  ptkp_k_3: rupiah.optional(),
  bracket_1_limit: rupiah.optional(),
  bracket_1_rate: percent.optional(),
  bracket_2_limit: rupiah.optional(),
  bracket_2_rate: percent.optional(),
  bracket_3_limit: rupiah.optional(),
  bracket_3_rate: percent.optional(),
  bracket_4_limit: rupiah.optional(),
  bracket_4_rate: percent.optional(),
  bracket_5_rate: percent.optional(),
  jabatan_expense_percentage: percent.optional(),
  jabatan_expense_max: rupiah.optional(),
  is_active: z.boolean().optional(),
}).superRefine((data, ctx) =>
  refineIncreasingLimits(
    ["bracket_1_limit", "bracket_2_limit", "bracket_3_limit", "bracket_4_limit"],
    data,
    ctx
  )
);

export const payrollSettingsPutSchema = z.object({
  settings: settingsSchema.optional(),
  tax_config: taxConfigSchema.optional(),
});

export type PayrollSettingsInput = z.infer<typeof payrollSettingsPutSchema>;

export async function loadPayrollSettings(db: PgClient, taxYear: number) {
  const [{ data: settings }, { data: taxConfig }] = await Promise.all([
    db
      .from("payroll_settings")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db.from("payroll_tax_config").select("*").eq("tax_year", taxYear).maybeSingle(),
  ]);
  return { settings: settings ?? null, tax_config: taxConfig ?? null, tax_year: taxYear };
}

/** Update baris yang ada atau insert baru; kembalikan baris tersimpan. */
async function upsertRow(
  db: PgClient,
  table: "payroll_settings" | "payroll_tax_config",
  existingId: string | null,
  payload: Record<string, unknown>,
  insertDefaults: Record<string, unknown>
) {
  const { data, error } = existingId
    ? await db.from(table).update(payload).eq("id", existingId).select("*").single()
    : await db.from(table).insert({ ...insertDefaults, ...payload }).select("*").single();
  if (error) throw new Error(`Gagal menyimpan ${table}: ${error.message}`);
  return data;
}

export async function savePayrollSettings(db: PgClient, input: PayrollSettingsInput) {
  const updatedAt = new Date().toISOString();
  let savedSettings = null;
  let savedTaxConfig = null;

  if (input.settings) {
    const { data: existing } = await db
      .from("payroll_settings")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    savedSettings = await upsertRow(
      db,
      "payroll_settings",
      existing?.id ?? null,
      { ...input.settings, updated_at: updatedAt },
      { company_name: input.settings.company_name ?? "Perusahaan" }
    );
  }

  if (input.tax_config) {
    const { tax_year, ...taxFields } = input.tax_config;
    const { data: existing } = await db
      .from("payroll_tax_config")
      .select("id")
      .eq("tax_year", tax_year)
      .maybeSingle();
    savedTaxConfig = await upsertRow(
      db,
      "payroll_tax_config",
      existing?.id ?? null,
      { ...taxFields, updated_at: updatedAt },
      { tax_year }
    );
  }

  return { settings: savedSettings, tax_config: savedTaxConfig };
}
