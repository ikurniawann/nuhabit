import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import { unwrap, unwrapSingle } from "./workforce-route";

/**
 * Struktur gaji karyawan (hris.employee_salary), data finansial sensitif.
 * Satu versi aktif per karyawan: versi baru menonaktifkan versi sebelumnya.
 */

const amount = z.coerce.number().nonnegative();

const salaryFields = {
  fixed_allowance: amount.optional(),
  variable_allowance: amount.optional(),
  transport_allowance: amount.optional(),
  meal_allowance: amount.optional(),
  housing_allowance: amount.optional(),
  loan_deduction: amount.optional(),
  other_deduction: amount.optional(),
  ptkp_status: z.string().max(10).optional(),
  is_taxable: z.boolean().optional(),
  bpjs_tk_enrolled: z.boolean().optional(),
  bpjs_kes_enrolled: z.boolean().optional(),
  tapera_enrolled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
};

const REQUIRED_MESSAGE = "Employee ID dan base salary wajib diisi";

export const salaryCreateSchema = z.object({
  employee_id: z.string({ error: REQUIRED_MESSAGE }).min(1, REQUIRED_MESSAGE),
  base_salary: z.coerce.number({ error: REQUIRED_MESSAGE }).positive(REQUIRED_MESSAGE),
  effective_date: z.string().max(40).nullable().optional(),
  ...salaryFields,
});

/** PUT hanya kolom struktur gaji + end_date (karyawan & tanggal efektif tetap). */
export const salaryUpdateSchema = z.object({
  base_salary: amount.optional(),
  end_date: z.string().max(40).nullable().optional(),
  ...salaryFields,
});

export async function listSalaries(employeeId: string | null) {
  const db = await createServerPgClient();
  let builder = db
    .from("employee_salary")
    .select(`*, employee:employees (id, full_name, nip, photo_url)`)
    .order("effective_date", { ascending: false });
  if (employeeId) builder = builder.eq("employee_id", employeeId);
  return unwrap(await builder);
}

export async function createSalary(input: z.infer<typeof salaryCreateSchema>) {
  const db = await createServerPgClient();
  const { data: employee } = await db
    .from("employees")
    .select("id")
    .eq("id", input.employee_id)
    .single();
  if (!employee) throw ApiError.notFound("Karyawan tidak ditemukan");

  const now = new Date().toISOString();
  await db
    .from("employee_salary")
    .update({
      is_active: false,
      end_date: input.effective_date ? new Date(input.effective_date).toISOString() : now,
      updated_at: now,
    })
    .eq("employee_id", input.employee_id)
    .eq("is_active", true);

  return unwrap(
    await db
      .from("employee_salary")
      .insert({
        employee_id: input.employee_id,
        base_salary: input.base_salary,
        fixed_allowance: input.fixed_allowance || 0,
        variable_allowance: input.variable_allowance || 0,
        transport_allowance: input.transport_allowance || 0,
        meal_allowance: input.meal_allowance || 0,
        housing_allowance: input.housing_allowance || 0,
        loan_deduction: input.loan_deduction || 0,
        other_deduction: input.other_deduction || 0,
        ptkp_status: input.ptkp_status || "TK/0",
        is_taxable: input.is_taxable ?? true,
        bpjs_tk_enrolled: input.bpjs_tk_enrolled ?? true,
        bpjs_kes_enrolled: input.bpjs_kes_enrolled ?? true,
        tapera_enrolled: input.tapera_enrolled ?? true,
        effective_date: input.effective_date || now,
        notes: input.notes,
      })
      .select(`*, employee:employees (id, full_name, nip)`)
      .single()
  );
}

export async function getSalary(id: string) {
  const db = await createServerPgClient();
  return unwrapSingle(
    await db
      .from("employee_salary")
      .select(
        `*,
          employee:employees (
            id, full_name, nip, email, phone,
            position:positions (title),
            department:departments (name)
          )`
      )
      .eq("id", id)
      .single(),
    "Data salary tidak ditemukan"
  );
}

export async function updateSalary(id: string, patch: z.infer<typeof salaryUpdateSchema>) {
  const db = await createServerPgClient();
  return unwrap(
    await db
      .from("employee_salary")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(`*, employee:employees (id, full_name, nip)`)
      .single()
  );
}

/** Hapus = nonaktifkan versi gaji (riwayat payroll tetap utuh). */
export async function deactivateSalary(id: string) {
  const db = await createServerPgClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("employee_salary")
    .update({ is_active: false, end_date: now, updated_at: now })
    .eq("id", id);
  unwrap({ data: null, error });
}
