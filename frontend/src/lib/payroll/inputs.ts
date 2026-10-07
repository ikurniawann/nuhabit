/**
 * Payroll Input Loader
 *
 * Satu-satunya tempat pemuatan data karyawan untuk kalkulasi payroll , 
 * dipakai baik oleh batch calculate (semua karyawan dalam satu run)
 * maupun perhitungan per-karyawan.
 *
 * Fase B: hari kerja dihitung dari pola shift (employee_shifts), lembur
 * dari pengajuan approved yang terealisasi (dicocokkan absensi), menit
 * keterlambatan dari absensi v2, dan cuti di-clamp ke periode.
 */

import { createServerPgClient } from "@/lib/pg/create-client";
import type { EmployeeShiftRow } from "@/lib/hris/shifts";
import {
  calculatePayroll,
  type PayrollInput,
  type PayrollResult,
} from "./calculator";
import { loadPayrollConfig, type PayrollConfig } from "./config";
import {
  loanDeductionForPeriod,
  loanInstallmentDetails,
  type LoanDeductionRow,
} from "./loans";
import {
  clampedLeaveDays,
  computeLateStats,
  countScheduledDays,
  dateColToIso,
  eachDateOfPeriod,
  mergeDateRanges,
  periodBounds,
  periodCoverage,
  splitOvertimeHours,
  type AttendancePeriodRow,
  type DateRange,
} from "./period";
import { loadHolidayIndex } from "@/lib/hris/holidays-db";
import type { HolidayIndex } from "@/lib/hris/holidays";

type PgClient = Awaited<ReturnType<typeof createServerPgClient>>;

export interface EmployeeRow {
  id: string;
  full_name: string;
  join_date: string;
  employment_status: string;
}

/**
 * Fallback saat karyawan TIDAK punya pola shift sama sekali dan tidak ada
 * baris absensi pada periode: dilaporkan eksplisit via workingDaysSource.
 */
const FALLBACK_WORKING_DAYS = 20;

export type WorkingDaysSource = "shift_schedule" | "attendance" | "fallback";

/**
 * Muat PayrollInput seorang karyawan untuk satu periode.
 * Mengembalikan null bila karyawan belum punya struktur gaji aktif.
 */
export async function loadEmployeePayrollInput(
  db: PgClient,
  employee: EmployeeRow,
  periodMonth: number,
  periodYear: number,
  options: { includeThr?: boolean; holidays?: HolidayIndex } = {}
): Promise<(PayrollInput & { workingDaysSource: WorkingDaysSource }) | null> {
  const { start: startDate, end: endDate } = periodBounds(periodMonth, periodYear);

  // Hari libur periode ini (EPIC-036 Fase F): dipakai memisahkan jam lembur.
  // Pemanggil yang menghitung banyak karyawan sekaligus WAJIB memuatnya sekali
  // lalu mengoper lewat options, supaya tidak menjadi query per karyawan.
  const holidays = options.holidays ?? (await loadHolidayIndex(startDate, endDate));

  const { data: salary } = await db
    .from("employee_salary")
    .select("*")
    .eq("employee_id", employee.id)
    .eq("is_active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!salary) return null;

  const [
    { data: attendance },
    { data: scheduleRows },
    { data: overtimeRequests },
    { data: leaves },
    { data: contracts },
    { data: loans },
  ] = await Promise.all([
    db
      .from("attendance")
      .select("date, status, clock_out, is_late, late_minutes, overtime_hours")
      .gte("date", startDate)
      .lte("date", endDate)
      .eq("employee_id", employee.id),
    db
      .from("employee_shifts")
      .select("day_of_week, shift_id, effective_from, effective_to")
      .eq("employee_id", employee.id)
      .lte("effective_from", endDate),
    db
      .from("overtime_requests")
      .select("date, hours")
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .gte("date", startDate)
      .lte("date", endDate),
    // Semua cuti approved yang BERSINGGUNGAN dengan periode (lintas bulan
    // dihitung porsinya saja): sebelumnya hanya yang mulai di periode.
    db
      .from("leaves")
      .select("start_date, end_date, leave_type")
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .lte("start_date", endDate)
      .gte("end_date", startDate),
    // Kontrak yang MENYENTUH periode (Fase C): tipe utk kelayakan THR,
    // tanggal utk proraté masuk/keluar tengah bulan. Kontrak berstatus
    // apa pun kecuali draft dihitung (ended/terminated di tengah periode
    // tetap dibayar porsinya).
    db
      .from("employment_contracts")
      .select("contract_type, status, start_date, end_date")
      .eq("employee_id", employee.id)
      .neq("status", "draft")
      .lte("start_date", endDate)
      .order("start_date", { ascending: false })
      // longgar (bukan 5) agar rekalkulasi periode LAMA tetap menemukan
      // kontrak yang berlaku saat itu meski sudah banyak perpanjangan
      .limit(50),
    // Pinjaman approved yang masih berjalan → cicilan otomatis (Fase D)
    db
      .from("loans")
      .select(
        "id, loan_type, principal_amount, tenor_months, monthly_installment, remaining_balance, first_installment_month, first_installment_year, status, is_active"
      )
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .eq("is_active", true)
      .gt("remaining_balance", 0),
  ]);

  // PENTING: kolom `date` Postgres top-level kembali sebagai objek Date JS
  // (driver pg tanpa type parser khusus): SEMUA tanggal dinormalisasi ke
  // string ISO di sini sebelum masuk fungsi murni yang membandingkan string.
  const attendanceRows: AttendancePeriodRow[] = (attendance ?? []).map(
    (row: AttendancePeriodRow) => ({
      ...row,
      date: dateColToIso(row.date) ?? "",
    })
  );
  const schedule: EmployeeShiftRow[] = (scheduleRows ?? [])
    .map((row: EmployeeShiftRow) => ({
      ...row,
      effective_from: dateColToIso(row.effective_from) ?? "",
      effective_to: dateColToIso(row.effective_to),
    }))
    .filter(
      (row: EmployeeShiftRow) =>
        row.effective_from !== "" &&
        (row.effective_to === null || row.effective_to >= startDate)
    );

  // Cakupan kontrak = GABUNGAN semua kontrak non-draft yang menyentuh
  // periode (perpanjangan PKWT yang bersambungan tgl 15→16 terhitung satu
  // cakupan penuh, bukan proraté setengah bulan). Tipe kontrak utk THR
  // diambil dari kontrak dengan start_date terbaru yang menyentuh periode.
  type ContractRow = {
    contract_type: "pkwt" | "pkwtt";
    status: string;
    start_date: unknown;
    end_date: unknown;
  };
  const contractRows: ContractRow[] = contracts ?? [];
  const coverages: DateRange[] = [];
  let latestContract: ContractRow | null = null;
  for (const row of contractRows) {
    const start = dateColToIso(row.start_date);
    if (start === null) continue;
    const cov = periodCoverage(start, dateColToIso(row.end_date), startDate, endDate);
    if (!cov) continue;
    coverages.push(cov);
    if (latestContract === null) latestContract = row; // sudah terurut start_date DESC
  }
  const mergedCoverage = mergeDateRanges(coverages);
  const hasContract = mergedCoverage.length > 0;
  const isPartialCoverage =
    hasContract &&
    !(
      mergedCoverage.length === 1 &&
      mergedCoverage[0].start === startDate &&
      mergedCoverage[0].end === endDate
    );

  // Hari kerja: pola shift (utama) → hitungan absensi → fallback 20.
  // Bila cakupan kontrak parsial, hari kerja & gaji diproraté ke porsi
  // cakupan (basis hari terjadwal: keputusan owner; kalender bila tanpa pola).
  const { scheduledDays, hasSchedule } = countScheduledDays(
    schedule,
    startDate,
    endDate
  );
  const coveredScheduledDays = mergedCoverage.reduce(
    (acc, range) =>
      acc + countScheduledDays(schedule, range.start, range.end).scheduledDays,
    0
  );
  const totalCalendarDays = eachDateOfPeriod(startDate, endDate).length;
  const coveredCalendarDays = mergedCoverage.reduce(
    (acc, range) => acc + eachDateOfPeriod(range.start, range.end).length,
    0
  );
  const inCoverage = (dateIso: string): boolean =>
    !hasContract ||
    mergedCoverage.some((r) => dateIso >= r.start && dateIso <= r.end);
  const attendanceWorkingDays = attendanceRows.filter(
    (d) => d.status !== "absent" && (!isPartialCoverage || inCoverage(d.date))
  ).length;

  let workingDays: number;
  let workingDaysSource: WorkingDaysSource;
  let prorateFactor = 1;
  if (hasSchedule && scheduledDays > 0) {
    workingDaysSource = "shift_schedule";
    if (isPartialCoverage) {
      workingDays = coveredScheduledDays;
      prorateFactor = coveredScheduledDays / scheduledDays;
    } else {
      workingDays = scheduledDays;
    }
  } else if (attendanceWorkingDays > 0) {
    // Tanpa pola shift: denominator = hari hadir DALAM cakupan, proraté
    // berbasis hari kalender cakupan: keduanya se-basis agar tarif harian
    // (gaji proraté / hari kerja) tetap konsisten.
    workingDays = attendanceWorkingDays;
    workingDaysSource = "attendance";
    if (isPartialCoverage) {
      prorateFactor = coveredCalendarDays / totalCalendarDays;
    }
  } else {
    workingDaysSource = "fallback";
    if (isPartialCoverage) {
      prorateFactor = coveredCalendarDays / totalCalendarDays;
      workingDays = Math.max(1, Math.round(FALLBACK_WORKING_DAYS * prorateFactor));
    } else {
      workingDays = FALLBACK_WORKING_DAYS;
    }
  }

  // Cakupan parsial yang seluruhnya jatuh di hari libur terjadwal →
  // hindari pembagian nol di kalkulator dgn workingDays minimal 1.
  if (workingDays <= 0) workingDays = isPartialCoverage ? 1 : FALLBACK_WORKING_DAYS;

  // Konsisten dgn workingDays: hanya kehadiran di dalam cakupan kontrak
  const presentDays = attendanceRows.filter(
    (d) =>
      (d.status === "present" || d.status === "late") &&
      (!isPartialCoverage || inCoverage(d.date))
  ).length;
  const { lateDays, lateMinutes } = computeLateStats(attendanceRows);

  // Lembur: hanya pengajuan approved yang terealisasi (ada clock_out), dipisah
  // hari kerja vs hari libur resmi karena tarifnya berbeda (EPIC-036 Fase F).
  const { regularHours: overtimeHours, holidayHours: overtimeHolidayHours } =
    splitOvertimeHours(
      (overtimeRequests ?? []).flatMap(
        (r: { date: unknown; hours: unknown }) => {
          const date = dateColToIso(r.date);
          return date ? [{ date, hours: Number(r.hours) || 0 }] : [];
        }
      ),
      attendanceRows,
      holidays
    );

  // Hanya cuti unpaid yang memotong gaji; cuti berbayar = hadir dibayar.
  const leaveRows: { start_date: string; end_date: string; leave_type: string }[] =
    (leaves ?? []).map(
      (leave: { start_date: unknown; end_date: unknown; leave_type: string }) => ({
        start_date: dateColToIso(leave.start_date) ?? "",
        end_date: dateColToIso(leave.end_date) ?? "",
        leave_type: leave.leave_type,
      })
    );
  const unpaidLeaveDays = leaveRows
    .filter((leave) => leave.leave_type === "unpaid" && leave.start_date && leave.end_date)
    .reduce(
      (acc, leave) => acc + clampedLeaveDays(leave, startDate, endDate),
      0
    );

  // Cicilan pinjaman jatuh tempo periode ini
  const loanRows: LoanDeductionRow[] = loans ?? [];
  const loanDeduction = loanDeductionForPeriod(loanRows, periodMonth, periodYear);
  // Rincian dibekukan bersama payroll agar slip lama tidak ikut berubah saat
  // saldo pinjaman berkurang di periode berikutnya.
  const loanBreakdown = loanInstallmentDetails(loanRows, periodMonth, periodYear);

  return {
    employeeId: employee.id,
    periodMonth,
    periodYear,
    baseSalary: Number(salary.base_salary) || 0,
    fixedAllowance: Number(salary.fixed_allowance) || 0,
    variableAllowance: Number(salary.variable_allowance) || 0,
    transportAllowance: Number(salary.transport_allowance) || 0,
    mealAllowance: Number(salary.meal_allowance) || 0,
    housingAllowance: Number(salary.housing_allowance) || 0,
    overtimeHours,
    overtimeHolidayHours,
    workingDays,
    presentDays,
    lateDays,
    lateMinutes,
    unpaidLeaveDays,
    loanDeduction,
    loanBreakdown,
    joinDate: employee.join_date,
    employmentStatus: employee.employment_status,
    contractType: latestContract?.contract_type ?? null,
    prorateFactor,
    ptkpStatus: salary.ptkp_status || "TK/0",
    isTaxable: salary.is_taxable ?? true,
    bpjsTkEnrolled: salary.bpjs_tk_enrolled ?? true,
    bpjsKesEnrolled: salary.bpjs_kes_enrolled ?? true,
    taperaEnrolled: salary.tapera_enrolled ?? true,
    includeThr: options.includeThr ?? false,
    workingDaysSource,
  };
}

/**
 * Hitung payroll satu karyawan langsung dari database.
 */
export async function calculatePayrollForEmployee(
  employeeId: string,
  periodMonth: number,
  periodYear: number,
  config?: PayrollConfig
): Promise<PayrollResult | null> {
  const db = await createServerPgClient();

  const { data: employee } = await db
    .from("employees")
    .select("id, full_name, join_date, employment_status")
    .eq("id", employeeId)
    .maybeSingle();

  if (!employee) return null;

  const input = await loadEmployeePayrollInput(
    db,
    employee,
    periodMonth,
    periodYear
  );
  if (!input) return null;

  const resolvedConfig = config ?? (await loadPayrollConfig(db, periodYear));
  return calculatePayroll(input, resolvedConfig);
}
