/**
 * Data run payroll (EPIC-008): daftar, buat, detail, transisi status, hapus.
 * Transisi `paid` memotong saldo pinjaman dalam satu transaksi.
 */

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import type { PgClient } from "@/lib/pg/create-client";
import { allocateLoanPayment, isLoanDue, type LoanDeductionRow } from "./loans";
import { periodLabelId } from "./period";
import { canDeleteRun, canTransitionRunStatus } from "./run-status";

const PERSON = "id, full_name, nip";
const RUN_SELECT = `*, processed_by:employees!processed_by ( ${PERSON} ), approved_by:employees!approved_by ( ${PERSON} )`;
const RUN_DETAIL_SELECT = `${RUN_SELECT},
  payroll_details:payroll_details (
    id, employee_id, base_salary, fixed_allowance, variable_allowance, transport_allowance,
    meal_allowance, housing_allowance, overtime_pay, thr, bonus, other_earning,
    gross_salary, bpjs_tk_jht_deduction, bpjs_tk_jp_deduction, bpjs_kes_deduction,
    tapera_deduction, pph21_deduction, unpaid_leave_deduction, late_deduction,
    loan_deduction, other_deduction, total_deductions, net_salary,
    status, payslip_sent, payslip_sent_at, payslip_emailed_at, payslip_email_recipient, payslip_resend_id,
    employee:employees!employee_id ( ${PERSON}, email, is_active, bank_name, bank_account, department_id, department:departments ( name ) )
  )`;

export const runListQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  status: z.string().min(1).optional(),
});

export const createRunSchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  run_name: z.string().nullish(),
});

export const updateRunSchema = z.object({
  status: z.string().optional(),
  notes: z.string().nullish(),
});

/** Record karyawan milik akun (processed_by/approved_by ber-FK ke employees). */
async function employeeIdOfUser(db: PgClient, userId: string): Promise<string | undefined> {
  const { data } = await db.from("employees").select("id").eq("auth_id", userId).maybeSingle();
  return data?.id;
}

export async function listRuns(db: PgClient, filter: z.infer<typeof runListQuerySchema>) {
  let query = db
    .from("payroll_runs")
    .select(RUN_SELECT)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });
  if (filter.year) query = query.eq("period_year", filter.year);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function createRun(
  db: PgClient,
  userId: string,
  input: z.infer<typeof createRunSchema>
) {
  const { period_month: month, period_year: year } = input;
  const { data: existing } = await db
    .from("payroll_runs")
    .select("id")
    .eq("period_month", month)
    .eq("period_year", year)
    .maybeSingle();
  if (existing) throw ApiError.badRequest("Payroll untuk periode ini sudah ada");

  const { data, error } = await db
    .from("payroll_runs")
    .insert({
      run_name: input.run_name || `Payroll ${periodLabelId(month, year)}`,
      period_month: month,
      period_year: year,
      status: "draft",
      processed_by: await employeeIdOfUser(db, userId),
    })
    .select(`*, processed_by:employees!processed_by ( ${PERSON} )`)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getRun(db: PgClient, id: string) {
  const { data, error } = await db.from("payroll_runs").select(RUN_DETAIL_SELECT).eq("id", id).single();
  if (error?.code === "PGRST116") throw ApiError.notFound("Payroll run tidak ditemukan");
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Slip berisi potongan cicilan yang tidak lagi cocok dengan saldo pinjaman
 * saat ini (mis. run periode lain dibayar duluan). Transaksi WAJIB batal agar
 * potongan di slip tidak hilang tanpa teralokasi ke pinjaman mana pun.
 */
class LoanAllocationMismatchError extends Error {
  constructor(public shortfalls: { employee_id: string; amount: number }[]) {
    super("Alokasi cicilan pinjaman tidak cocok dengan slip");
    this.name = "LoanAllocationMismatchError";
  }
}

/** Potong saldo pinjaman sesuai cicilan di slip run ini; kembalikan jumlah pinjaman tersentuh. */
async function settleRunLoans(
  client: PoolClient,
  runId: string,
  periodMonth: number,
  periodYear: number
): Promise<number> {
  const { rows: details } = await client.query<{ employee_id: string; loan_deduction: string }>(
    `SELECT employee_id, loan_deduction
     FROM hris.payroll_details
     WHERE payroll_run_id = $1 AND loan_deduction > 0`,
    [runId]
  );

  let settledLoans = 0;
  const shortfalls: { employee_id: string; amount: number }[] = [];
  for (const detail of details) {
    // FOR UPDATE: kunci baris pinjaman agar alokasi tidak balapan
    const { rows: loans } = await client.query<LoanDeductionRow>(
      `SELECT id, monthly_installment, remaining_balance,
              first_installment_month, first_installment_year,
              status, is_active
       FROM hris.loans
       WHERE employee_id = $1 AND status = 'approved' AND is_active = true
         AND remaining_balance > 0
       ORDER BY approved_at ASC NULLS LAST, created_at ASC
       FOR UPDATE`,
      [detail.employee_id]
    );

    const dueLoans = loans.filter((loan) => isLoanDue(loan, periodMonth, periodYear));
    const deducted = Math.round(Number(detail.loan_deduction));
    const allocations = allocateLoanPayment(dueLoans, deducted);

    // Slip memotong X tapi hanya Y yang bisa dialokasikan: kumpulkan
    // selisihnya lalu batalkan transaksi, jangan commit diam-diam.
    const allocated = allocations.reduce((acc, a) => acc + a.amount, 0);
    if (allocated < deducted) {
      shortfalls.push({ employee_id: detail.employee_id, amount: deducted - allocated });
      continue;
    }

    for (const alloc of allocations) {
      await client.query(
        // $2 di-cast eksplisit: dipakai sebagai nilai kolom numeric DAN
        // dibandingkan dengan literal 0; tanpa cast Postgres menolak dengan
        // "inconsistent types deduced for parameter $2".
        `UPDATE hris.loans
         SET remaining_balance = $2::numeric,
             paid_amount = COALESCE(paid_amount, 0) + $3::numeric,
             is_active = CASE WHEN $2::numeric <= 0 THEN false ELSE is_active END,
             status = CASE WHEN $2::numeric <= 0 THEN 'paid_off' ELSE status END,
             updated_at = now()
         WHERE id = $1`,
        [alloc.loanId, alloc.newRemaining, alloc.amount]
      );
      settledLoans += 1;
    }
  }

  if (shortfalls.length > 0) throw new LoanAllocationMismatchError(shortfalls);
  return settledLoans;
}

/**
 * Tandai run paid + kurangi saldo pinjaman secara atomik. Guard
 * `status = 'completed'` di SQL membuat operasi idempoten: pemanggilan kedua
 * tidak mengubah run dan TIDAK memotong saldo dua kali.
 */
async function markRunPaid(
  runId: string,
  periodMonth: number,
  periodYear: number,
  notes: string | null
): Promise<number> {
  try {
    return await withTransaction(async (client) => {
      const runUpdate = await client.query(
        `UPDATE hris.payroll_runs
         SET status = 'paid', paid_at = now(), updated_at = now(),
             notes = COALESCE($2, notes)
         WHERE id = $1 AND status = 'completed'
         RETURNING id`,
        [runId, notes]
      );
      if (runUpdate.rowCount === 0) {
        throw ApiError.conflict("Run sudah diproses/berubah status — muat ulang halaman");
      }
      return settleRunLoans(client, runId, periodMonth, periodYear);
    });
  } catch (error) {
    if (error instanceof LoanAllocationMismatchError) {
      throw new ApiError(
        409,
        "Cicilan pinjaman di slip tidak lagi cocok dengan saldo pinjaman saat ini " +
          "(kemungkinan run periode lain ditandai dibayar lebih dulu). " +
          "Hapus run ini lalu buat & hitung ulang sebelum menandai dibayar.",
        { shortfalls: error.shortfalls }
      );
    }
    throw error;
  }
}

/** Transisi status run (process → approve → pay) dan/atau catatan. */
export async function updateRun(
  db: PgClient,
  userId: string,
  id: string,
  input: z.infer<typeof updateRunSchema>
) {
  const { data: existing } = await db
    .from("payroll_runs")
    .select("id, status, period_month, period_year")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw ApiError.notFound("Payroll run tidak ditemukan");

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };
  if (input.notes !== undefined) update.notes = input.notes;

  const { status } = input;
  if (status && status !== existing.status) {
    if (!canTransitionRunStatus(existing.status, status)) {
      throw ApiError.badRequest(`Transisi status '${existing.status}' → '${status}' tidak diizinkan`);
    }

    if (status === "paid") {
      // EPIC-008 Fase D: paid = SATU transaksi (status + saldo pinjaman)
      const settledLoans = await markRunPaid(
        id,
        existing.period_month,
        existing.period_year,
        input.notes ?? null
      );
      const { data } = await db.from("payroll_runs").select(RUN_SELECT).eq("id", id).single();
      return {
        data,
        message: `Payroll ditandai dibayar${settledLoans > 0 ? ` — ${settledLoans} cicilan pinjaman dipotong dari saldo` : ""}`,
      };
    }

    update.status = status;
    const actorEmployeeId = await employeeIdOfUser(db, userId);
    if (status === "processing") {
      update.processed_by = actorEmployeeId;
      update.processed_at = now;
    } else if (status === "completed") {
      update.approved_by = actorEmployeeId;
      update.approved_at = now;
    }
  }

  const { data, error } = await db
    .from("payroll_runs")
    .update(update)
    .eq("id", id)
    .select(RUN_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return { data, message: "Payroll run berhasil diupdate" };
}

export async function deleteRun(db: PgClient, id: string): Promise<void> {
  const { data: existing } = await db
    .from("payroll_runs")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw ApiError.notFound("Payroll run tidak ditemukan");
  if (!canDeleteRun(existing.status)) {
    throw ApiError.badRequest("Payroll yang sudah dibayar tidak bisa dihapus");
  }
  // FK payroll_details_run_fk ON DELETE CASCADE ikut menghapus detail
  const { error } = await db.from("payroll_runs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
