/**
 * Slip gaji (EPIC-008 Fase E): daftar ber-scope, pengiriman email, dan baris
 * sumber PDF. Slip gaji adalah PII finansial; scoping dilakukan di server.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import type { WorkforceActor } from "@/lib/hris/workforce-auth";
import type { PayslipAmounts } from "@/lib/hris/payslip-pdf";
import { buildPayslipPdf, payslipFileName } from "@/lib/hris/payslip-pdf";
import type { PgClient } from "@/lib/pg/create-client";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import { escapeHtml } from "@/lib/security/escape-html";
import { Resend } from "resend";
import type { LoanInstallmentDetail } from "./loans";
import { periodLabelId } from "./period";

/** Akses penuh lintas karyawan. */
const PAYSLIP_FULL_ROLES = ["super_admin", "hrd", "finance_staff"] as const;

export const payslipListQuerySchema = z.object({
  employee_id: z.string().optional(),
  payroll_run_id: z.string().optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().optional(),
});

/**
 * Scoping daftar slip:
 * - employee_id=me → tampilan PERSONAL utk semua role (termasuk HR): slip
 *   milik sendiri + hanya run paid. Dipakai halaman ESS.
 * - non-HR → selalu dipaksa ke miliknya sendiri.
 * - HR → akses penuh, filter employee_id opsional.
 * `employeeId: undefined` = aktor tanpa record karyawan pada tampilan personal.
 */
export function resolvePayslipScope(
  actor: Pick<WorkforceActor, "role" | "employeeId">,
  employeeIdParam: string | undefined
): { meView: boolean; employeeId: string | null | undefined } {
  const fullAccess = (PAYSLIP_FULL_ROLES as readonly string[]).includes(actor.role);
  const meView = employeeIdParam === "me" || !fullAccess;
  if (meView) return { meView, employeeId: actor.employeeId ?? undefined };
  return { meView, employeeId: employeeIdParam ?? null };
}

export async function listPayslips(
  db: PgClient,
  actor: WorkforceActor,
  filter: z.infer<typeof payslipListQuerySchema>
) {
  const scope = resolvePayslipScope(actor, filter.employee_id);
  if (scope.employeeId === undefined) return [];

  let query = db
    .from("payroll_details")
    .select(`
      *,
      employee:employees ( id, full_name, nip, photo_url,
        position:positions ( title ), department:departments ( name ) ),
      payroll_run:payroll_runs ( id, run_name, period_month, period_year, status, paid_at )
    `)
    .order("created_at", { ascending: false })
    .limit(60);
  if (scope.employeeId) query = query.eq("employee_id", scope.employeeId);
  if (filter.payroll_run_id) query = query.eq("payroll_run_id", filter.payroll_run_id);
  if (filter.year) query = query.eq("period_year", filter.year);
  if (filter.month) query = query.eq("period_month", filter.month);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Tampilan personal hanya memuat slip yang gajinya SUDAH dibayar; run
  // draft/processing/completed masih bisa berubah.
  const rows = (data ?? []) as { payroll_run?: { status?: string } | null }[];
  return scope.meView ? rows.filter((row) => row.payroll_run?.status === "paid") : rows;
}

/** Kirim PDF slip gaji ke email karyawan dan catat hanya setelah diterima Resend. */
export async function notifyPayslip(db: PgClient, payrollDetailId: string) {
  const { data: detail } = await db
    .from("payroll_details")
    .select(`
      id, payslip_sent,
      employee:employees ( id, full_name, email, is_active ),
      payroll_run:payroll_runs ( id, period_month, period_year, status )
    `)
    .eq("id", payrollDetailId)
    .maybeSingle();
  if (!detail) throw ApiError.notFound("Slip tidak ditemukan");
  if (detail.payroll_run?.status !== "paid") {
    throw ApiError.badRequest("Notifikasi hanya untuk run yang sudah dibayar");
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.PAYROLL_FROM_EMAIL || process.env.FROM_EMAIL || "").trim();
  if (!apiKey || !from) throw new ApiError(503, "Pengiriman email slip gaji belum dikonfigurasi");
  const email = detail.employee?.email?.trim();
  if (!detail.employee?.is_active || !email) throw ApiError.badRequest("Email karyawan aktif belum tersedia");
  if (!z.email().safeParse(email).success) throw ApiError.badRequest("Email karyawan tidak valid");

  const row = await loadPayslipPdfRow(payrollDetailId);
  if (!row) throw ApiError.notFound("Data karyawan untuk slip tidak ditemukan");
  const settings = await getSettings([
    SETTING_KEYS.COMPANY_LEGAL_NAME, SETTING_KEYS.COMPANY_ADDRESS, SETTING_KEYS.COMPANY_CITY,
  ]).catch(() => ({}) as Record<string, string | null>);
  const period = {
    month: Number(row.period_month), year: Number(row.period_year),
    paid_at: row.paid_at, status: row.run_status,
  };
  const pdf = await buildPayslipPdf({
    company: {
      legal_name: settings[SETTING_KEYS.COMPANY_LEGAL_NAME] ?? null,
      address: settings[SETTING_KEYS.COMPANY_ADDRESS] ?? null,
      city: settings[SETTING_KEYS.COMPANY_CITY] ?? null,
    },
    employee: {
      full_name: row.full_name, nip: row.nip,
      position_title: row.position_title, department_name: row.department_name,
    },
    period, amounts: payslipAmounts(row),
  });
  const periodLabel = periodLabelId(period.month, period.year);
  let resendId: string;
  try {
    const { data: sent, error } = await new Resend(apiKey).emails.send({
      from, to: email, subject: `Slip Gaji NüHabit — ${periodLabel}`,
      html: `<p>Halo ${escapeHtml(row.full_name)},</p><p>Slip gaji periode ${escapeHtml(periodLabel)} terlampir dalam email ini.</p><p>Salam,<br>NüHabit</p>`,
      attachments: [{ filename: payslipFileName(row.full_name, period), content: pdf }],
    });
    if (error || !sent?.id) throw new Error("Resend did not accept the email");
    resendId = sent.id;
  } catch {
    throw new ApiError(502, "Email slip gaji gagal dikirim; coba lagi");
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("payroll_details")
    .update({ payslip_sent: true, payslip_sent_at: sentAt, payslip_emailed_at: sentAt,
      payslip_email_recipient: email, payslip_resend_id: resendId })
    .eq("id", payrollDetailId);
  if (updateError) throw new Error(updateError.message);

  return {
    data: { email, payslip_sent: true },
    message: "Email slip gaji diterima Resend",
  };
}

export type PayslipPdfRow = {
  employee_id: string;
  full_name: string;
  nip: string | null;
  position_title: string | null;
  department_name: string | null;
  period_month: number;
  period_year: number;
  run_status: string;
  paid_at: string | null;
  loan_details: LoanInstallmentDetail[] | null;
} & Record<string, unknown>;

export function loadPayslipPdfRow(id: string): Promise<PayslipPdfRow | null> {
  return queryOne<PayslipPdfRow>(
    `SELECT pd.*,
            e.id AS employee_id, e.full_name, e.nip,
            p.title AS position_title,
            d.name  AS department_name,
            r.period_month, r.period_year,
            r.status AS run_status, r.paid_at
       FROM hris.payroll_details pd
       JOIN hris.employees e ON e.id = pd.employee_id
       LEFT JOIN hris.positions p ON p.id = e.job_title_id
       LEFT JOIN hris.departments d ON d.id = e.department_id
       JOIN hris.payroll_runs r ON r.id = pd.payroll_run_id
      WHERE pd.id = $1`,
    [id]
  );
}

const num = (value: unknown): number => Number(value ?? 0) || 0;

/** Nominal slip dari snapshot payroll_details (kolom numeric → number). */
export function payslipAmounts(row: PayslipPdfRow): PayslipAmounts {
  return {
    base_salary: num(row.base_salary),
    fixed_allowance: num(row.fixed_allowance),
    variable_allowance: num(row.variable_allowance),
    transport_allowance: num(row.transport_allowance),
    meal_allowance: num(row.meal_allowance),
    housing_allowance: num(row.housing_allowance),
    overtime_pay: num(row.overtime_pay),
    thr: num(row.thr),
    bonus: num(row.bonus),
    other_earning: num(row.other_earning),
    gross_salary: num(row.gross_salary),
    bpjs_tk_jht_deduction: num(row.bpjs_tk_jht_deduction),
    bpjs_tk_jp_deduction: num(row.bpjs_tk_jp_deduction),
    bpjs_kes_deduction: num(row.bpjs_kes_deduction),
    tapera_deduction: num(row.tapera_deduction),
    pph21_deduction: num(row.pph21_deduction),
    unpaid_leave_deduction: num(row.unpaid_leave_deduction),
    late_deduction: num(row.late_deduction),
    loan_deduction: num(row.loan_deduction),
    other_deduction: num(row.other_deduction),
    total_deductions: num(row.total_deductions),
    net_salary: num(row.net_salary),
    working_days: num(row.working_days),
    present_days: num(row.present_days),
    overtime_hours: num(row.overtime_hours),
    loan_details: Array.isArray(row.loan_details) ? row.loan_details : [],
  };
}
