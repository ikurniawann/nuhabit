/**
 * Pengajuan & persetujuan pinjaman karyawan (EPIC-008 Fase D).
 * HR/finance mengelola semua; karyawan hanya pinjaman miliknya (ESS) dan
 * self-request selalu tanpa bunga (kasbon).
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { WorkforceActor } from "@/lib/hris/workforce-auth";
import type { PgClient } from "@/lib/pg/create-client";
import { loadPayrollConfig } from "./config";
import { computeLoanTerms, firstInstallmentPeriod, validateLoanLimits } from "./loans";
import { LOAN_MANAGE_ROLES } from "./roles";

const EMPLOYEE_BRIEF = "id, full_name, nip";

export function hasLoanFullAccess(role: string): boolean {
  return (LOAN_MANAGE_ROLES as readonly string[]).includes(role);
}

export const loanListQuerySchema = z.object({
  employee_id: z.string().optional(),
  status: z.string().optional(),
});

const INVALID_LOAN = "Jenis pinjaman, jumlah (> 0), dan tenor (1–60 bulan) wajib valid";

export const createLoanSchema = z.object({
  employee_id: z.string().nullish(),
  loan_type: z.string({ error: INVALID_LOAN }).min(1, INVALID_LOAN),
  principal_amount: z.coerce.number({ error: INVALID_LOAN }).positive(INVALID_LOAN),
  interest_rate: z.unknown().optional(),
  tenor_months: z.coerce
    .number({ error: INVALID_LOAN })
    .int(INVALID_LOAN)
    .min(1, INVALID_LOAN)
    .max(60, INVALID_LOAN),
  purpose: z.string().nullish(),
  notes: z.string().nullish(),
});

export const decideLoanSchema = z.object({
  approved: z.boolean().optional(),
  rejection_reason: z.string().nullish(),
});

/** Gaji pokok aktif + jumlah pinjaman yang masih menghitung limit. */
async function loadLoanLimitContext(db: PgClient, employeeId: string, includePending: boolean) {
  const loans = db
    .from("loans")
    .select("id, status, remaining_balance")
    .eq("employee_id", employeeId)
    .eq("is_active", true);
  const [config, { data: salary }, { data: activeLoans }] = await Promise.all([
    loadPayrollConfig(db, new Date().getFullYear()),
    db
      .from("employee_salary")
      .select("base_salary")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    includePending
      ? loans.in("status", ["pending", "approved"])
      : loans.eq("status", "approved").gt("remaining_balance", 0),
  ]);
  const rows = (activeLoans ?? []) as { status: string; remaining_balance: unknown }[];
  return {
    config,
    baseSalary: salary ? Number(salary.base_salary) : null,
    activeLoanCount: rows.filter(
      (loan) => loan.status === "pending" || Number(loan.remaining_balance) > 0
    ).length,
  };
}

export async function listLoans(
  db: PgClient,
  actor: WorkforceActor,
  filter: z.infer<typeof loanListQuerySchema>
) {
  // Non-HR (atau employee_id=me) dipaksa ke pinjaman sendiri
  let employeeId: string | null = null;
  if (!hasLoanFullAccess(actor.role) || filter.employee_id === "me") {
    if (!actor.employeeId) return [];
    employeeId = actor.employeeId;
  } else if (filter.employee_id) {
    employeeId = filter.employee_id;
  }

  let query = db
    .from("loans")
    .select(`
      *,
      employee:employees!employee_id ( ${EMPLOYEE_BRIEF}, photo_url, department:departments ( name ) ),
      approved_by:employees!approved_by ( ${EMPLOYEE_BRIEF} )
    `)
    .order("created_at", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function createLoan(
  db: PgClient,
  actor: WorkforceActor,
  input: z.infer<typeof createLoanSchema>
) {
  const fullAccess = hasLoanFullAccess(actor.role);
  // HR bisa untuk siapa pun; karyawan hanya untuk dirinya
  const targetEmployeeId =
    fullAccess && input.employee_id && input.employee_id !== "me"
      ? input.employee_id
      : actor.employeeId;
  if (!targetEmployeeId) throw ApiError.badRequest("Akun ini tidak tertaut ke data karyawan");

  // Self-request karyawan: bunga selalu 0 (kasbon); HR yang bisa set bunga
  const rate = fullAccess ? Number(input.interest_rate) || 0 : 0;
  if (rate < 0 || rate > 100) throw ApiError.badRequest(INVALID_LOAN);

  const { data: employee } = await db
    .from("employees")
    .select("id, is_active")
    .eq("id", targetEmployeeId)
    .maybeSingle();
  if (!employee) throw ApiError.notFound("Karyawan tidak ditemukan");
  if (!employee.is_active) throw ApiError.badRequest("Karyawan sudah tidak aktif");

  const terms = computeLoanTerms({
    principal: input.principal_amount,
    ratePercent: rate,
    tenorMonths: input.tenor_months,
  });

  // Limit (konfigurabel di pengaturan payroll): cicilan maks % gaji pokok +
  // jumlah pinjaman aktif maks per karyawan
  const limits = await loadLoanLimitContext(db, targetEmployeeId, true);
  const limitError = validateLoanLimits({
    monthlyInstallment: terms.rawInstallment,
    baseSalary: limits.baseSalary,
    maxInstallmentPercent: limits.config.loan.maxInstallmentPercent,
    activeLoanCount: limits.activeLoanCount,
    maxActiveLoans: limits.config.loan.maxActivePerEmployee,
  });
  if (limitError) throw ApiError.badRequest(limitError);

  const { data, error } = await db
    .from("loans")
    .insert({
      employee_id: targetEmployeeId,
      loan_type: input.loan_type,
      principal_amount: input.principal_amount,
      interest_rate: rate,
      tenor_months: input.tenor_months,
      monthly_installment: terms.monthlyInstallment,
      // Sisa kewajiban = total yang harus dibayar (termasuk bunga) agar
      // cicilan bulanan mengikisnya sampai 0.
      remaining_balance: terms.totalRepayment,
      purpose: input.purpose,
      notes: input.notes,
      status: "pending",
    })
    .select(`*, employee:employees!employee_id ( ${EMPLOYEE_BRIEF} )`)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Setujui/tolak pinjaman pending; limit divalidasi ulang saat approve. */
export async function decideLoan(
  db: PgClient,
  userId: string,
  loanId: string,
  input: z.infer<typeof decideLoanSchema>
) {
  // approved_by/rejected_by ber-FK ke hris.employees
  const [{ data: approver }, { data: loan }] = await Promise.all([
    db.from("employees").select("id").eq("auth_id", userId).maybeSingle(),
    db.from("loans").select("*").eq("id", loanId).maybeSingle(),
  ]);
  if (!loan) throw ApiError.notFound("Pinjaman tidak ditemukan");
  if (loan.status !== "pending") throw ApiError.badRequest("Pinjaman sudah diproses");

  const now = new Date();
  const update: Record<string, unknown> = { updated_at: now.toISOString() };

  if (input.approved) {
    // Gaji/pinjaman lain bisa berubah sejak pengajuan dibuat
    const limits = await loadLoanLimitContext(db, loan.employee_id, false);
    const limitError = validateLoanLimits({
      monthlyInstallment: Number(loan.monthly_installment),
      baseSalary: limits.baseSalary,
      maxInstallmentPercent: limits.config.loan.maxInstallmentPercent,
      activeLoanCount: limits.activeLoanCount,
      maxActiveLoans: limits.config.loan.maxActivePerEmployee,
    });
    if (limitError) throw ApiError.badRequest(limitError);

    // Gaji bulan ini biasanya sudah/sedang diproses saat pinjaman cair
    const first = firstInstallmentPeriod(now);
    Object.assign(update, {
      status: "approved",
      approved_by: approver?.id,
      approved_at: now.toISOString(),
      first_installment_month: first.month,
      first_installment_year: first.year,
    });
  } else {
    Object.assign(update, {
      status: "rejected",
      rejected_by: approver?.id,
      rejected_at: now.toISOString(),
      rejection_reason: input.rejection_reason || "Tidak disetujui",
      is_active: false,
    });
  }

  const { data, error } = await db
    .from("loans")
    .update(update)
    .eq("id", loanId)
    .eq("status", "pending")
    .select(`
      *,
      employee:employees!employee_id ( ${EMPLOYEE_BRIEF} ),
      approved_by:employees!approved_by ( ${EMPLOYEE_BRIEF} )
    `)
    .single();
  if (error?.code === "PGRST116") throw ApiError.conflict("Pinjaman sudah diproses oleh orang lain");
  if (error) throw new Error(error.message);

  return {
    data,
    message: input.approved ? "Pinjaman disetujui — cicilan mulai bulan depan" : "Pinjaman ditolak",
  };
}
