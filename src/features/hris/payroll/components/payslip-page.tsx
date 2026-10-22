"use client";

import {
  loanInstallmentLabel,
  type LoanInstallmentDetail,
} from "@/lib/payroll/loans";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatShareOfGross } from "@/lib/payroll/share";
import { Badge } from "@/components/ui/badge";
import { ArrowDownTrayIcon,
  PrinterIcon, ArrowDownOnSquareIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import { usePayslip } from "../queries";
import { prorateNote } from "@/lib/payroll/prorate-note";

interface PayrollDetail {
  id: string;
  employee_id: string;
  payroll_run_id: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  overtime_pay: number;
  thr: number;
  bonus: number;
  other_earning: number;
  gross_salary: number;
  bpjs_tk_jht_deduction: number;
  bpjs_tk_jp_deduction: number;
  bpjs_kes_deduction: number;
  tapera_deduction: number;
  pph21_deduction: number;
  unpaid_leave_deduction: number;
  late_deduction?: number;
  loan_deduction?: number;
  loan_details?: LoanInstallmentDetail[];
  other_deduction: number;
  total_deductions: number;
  net_salary: number;
  working_days: number;
  present_days: number;
  late_days: number;
  unpaid_leave_days: number;
  /** Faktor proraté cakupan kontrak (0..1); pg numeric datang sebagai string */
  prorate_factor?: number | string;
  /** Snapshot gaji pokok penuh sebelum proraté (null utk baris lama) */
  full_base_salary?: number | string | null;
  status: string;
  created_at: string;
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    email: string;
    phone: string;
    position?: {
      title: string;
    };
    department?: {
      name: string;
    };
  };
  payroll_run?: {
    id: string;
    period_month: number;
    period_year: number;
    run_name: string;
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

function getMonthName(month: number): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return months[month - 1] || "";
}

export function PayslipPage() {
  const params = useParams();
  const router = useRouter();

  const payrollRunId = params.id as string;
  const employeeId = params.employeeId as string;

  const payslipQuery = usePayslip(payrollRunId, employeeId);
  const detail = (payslipQuery.data as PayrollDetail | null) ?? null;
  const slipProrateNote = detail
    ? prorateNote({
        factor: detail.prorate_factor,
        fullBase: detail.full_base_salary,
        paidBase: detail.base_salary,
      })
    : null;
  const loading = payslipQuery.isLoading;

  function handlePrint() {
    window.print();
  }

  /** Porsi potongan terhadap bruto — makna sama untuk semua baris. */
  const bagian = (amount: number | undefined) =>
    formatShareOfGross(Number(amount) || 0, Number(detail?.gross_salary) || 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-gray-500 mb-4">Slip gaji tidak ditemukan</p>
            <Button onClick={() => router.push(`/dashboard/hris/payroll/${payrollRunId}`)}>
              Kembali ke Payroll
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const employee = detail.employee;
  const payrollRun = detail.payroll_run;

  return (
    <div className="container mx-auto py-8 max-w-4xl print:max-w-none">
      {/* Header Actions - Hidden on Print */}
      <div className="mb-6 flex items-center justify-between no-print">
        <Button
          variant="outline"
          onClick={() => router.push(`/dashboard/hris/payroll/${payrollRunId}`)}
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Kembali
        </Button>
        <div className="flex gap-2">
          {/* PDF dibuat server (pdfkit) — hasilnya seragam di semua perangkat,
              tidak seperti cetak browser. Memakai <a> + buttonVariants karena
              Button di repo ini tidak mendukung asChild. */}
          <a
            href={`/api/hris/payslips/${detail.id}/pdf`}
            download
            className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:translate-y-px"
          >
            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
            Unduh PDF
          </a>
          <Button variant="outline" onClick={handlePrint}>
            <PrinterIcon className="w-4 h-4 mr-2" />
            Cetak
          </Button>
        </div>
      </div>

      {/* Payslip Content */}
      <Card className="print:shadow-none print:border-0">
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Slip Gaji</h1>
              <p className="text-sm text-gray-500 mt-1">
                Periode: {getMonthName(payrollRun?.period_month || 0)} {payrollRun?.period_year}
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-700">
              {payrollRun?.run_name}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* Employee Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Nama Karyawan</p>
              <p className="font-semibold">{employee?.full_name}</p>
              <p className="text-sm text-gray-500">NIP</p>
              <p>{employee?.nip}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Jabatan</p>
              <p>{employee?.position?.title || "-"}</p>
              <p className="text-sm text-gray-500">Departemen</p>
              <p>{employee?.department?.name || "-"}</p>
            </div>
          </div>

          {/* Earnings */}
          <div>
            <h3 className="font-semibold text-lg mb-3 text-gray-700">Penghasilan</h3>
            <div className="space-y-2">
              <EarningRow label="Gaji Pokok" amount={detail.base_salary} />
              {slipProrateNote && (
                <p className="text-xs text-amber-700 italic -mt-1">
                  {slipProrateNote}
                </p>
              )}
              <EarningRow label="Tunjangan Tetap" amount={detail.fixed_allowance} />
              {detail.variable_allowance > 0 && (
                <EarningRow label="Tunjangan Variabel" amount={detail.variable_allowance} />
              )}
              {detail.transport_allowance > 0 && (
                <EarningRow label="Tunjangan Transport" amount={detail.transport_allowance} />
              )}
              {detail.meal_allowance > 0 && (
                <EarningRow label="Tunjangan Makan" amount={detail.meal_allowance} />
              )}
              {detail.housing_allowance > 0 && (
                <EarningRow label="Tunjangan Rumah" amount={detail.housing_allowance} />
              )}
              {detail.overtime_pay > 0 && (
                <EarningRow label="Lembur" amount={detail.overtime_pay} />
              )}
              {detail.thr > 0 && (
                <EarningRow label="THR" amount={detail.thr} />
              )}
              {detail.bonus > 0 && (
                <EarningRow label="Bonus" amount={detail.bonus} />
              )}
              <div className="border-t pt-2 mt-2">
                <EarningRow 
                  label="Total Penghasilan" 
                  amount={detail.gross_salary} 
                  bold 
                />
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div>
            <h3 className="font-semibold text-lg mb-3 text-red-700">Potongan</h3>
            <div className="space-y-2">
              <DeductionRow label="BPJS TK (JHT)" amount={detail.bpjs_tk_jht_deduction} share={bagian(detail.bpjs_tk_jht_deduction)} />
              <DeductionRow label="BPJS TK (JP)" amount={detail.bpjs_tk_jp_deduction} share={bagian(detail.bpjs_tk_jp_deduction)} />
              <DeductionRow label="BPJS Kesehatan" amount={detail.bpjs_kes_deduction} share={bagian(detail.bpjs_kes_deduction)} />
              <DeductionRow label="Tapera" amount={detail.tapera_deduction} share={bagian(detail.tapera_deduction)} />
              <DeductionRow label="PPh 21" amount={detail.pph21_deduction} share={bagian(detail.pph21_deduction)} />
              {detail.unpaid_leave_deduction > 0 && (
                <DeductionRow label="Cuti Tanpa Bayaran" amount={detail.unpaid_leave_deduction} share={bagian(detail.unpaid_leave_deduction)} />
              )}
              {(detail.late_deduction ?? 0) > 0 && (
                <DeductionRow label="Potongan Keterlambatan" amount={detail.late_deduction ?? 0} share={bagian(detail.late_deduction ?? 0)} />
              )}
              {(detail.loan_details?.length ?? 0) > 0
                ? detail.loan_details!.map((loan) => (
                    <DeductionRow
                      key={loan.loan_id}
                      label={loanInstallmentLabel(loan)}
                      amount={loan.amount}
                    />
                  ))
                : (detail.loan_deduction ?? 0) > 0 && (
                    <DeductionRow label="Cicilan Pinjaman" amount={detail.loan_deduction ?? 0} share={bagian(detail.loan_deduction ?? 0)} />
                  )}
              {detail.other_deduction > 0 && (
                <DeductionRow label="Potongan Lain" amount={detail.other_deduction} share={bagian(detail.other_deduction)} />
              )}
              <div className="border-t pt-2 mt-2">
                <DeductionRow 
                  label="Total Potongan" 
                  amount={detail.total_deductions} 
                  bold 
                />
              </div>
            </div>
          </div>

          {/* Net Salary */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Take Home Pay (Gaji Bersih)</p>
                <p className="text-2xl font-bold text-green-700">
                  {formatCurrency(detail.net_salary)}
                </p>
              </div>
              <div className="text-right text-sm text-gray-500">
                <p>Tanggal Cetak</p>
                <p>{new Date().toLocaleDateString('id-ID', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}</p>
              </div>
            </div>
          </div>

          {/* Attendance Summary */}
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Hari Kerja</p>
              <p className="text-lg font-semibold">{detail.working_days}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Hadir</p>
              <p className="text-lg font-semibold text-green-700">{detail.present_days}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Terlambat</p>
              <p className="text-lg font-semibold text-yellow-700">{detail.late_days}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Cuti (Unpaid)</p>
              <p className="text-lg font-semibold text-red-700">{detail.unpaid_leave_days}</p>
            </div>
          </div>

          {/* Footer Note */}
          <div className="border-t pt-4 mt-6 text-center text-sm text-gray-500">
            <p>Dokumen ini dicetak secara otomatis oleh sistem.</p>
            <p>Untuk pertanyaan mengenai slip gaji ini, silakan hubungi HRD.</p>
          </div>
        </CardContent>
      </Card>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white;
          }
        }
      `}</style>
    </div>
  );
}

function EarningRow({ label, amount, bold = false }: { label: string; amount: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-gray-700 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`text-gray-900 ${bold ? 'font-bold' : ''}`}>
        {amount > 0 ? formatCurrency(amount) : '-'}
      </span>
    </div>
  );
}

function DeductionRow({
  label,
  amount,
  bold = false,
  share,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  /** Porsi terhadap bruto, mis. "1,8%". Kosong = tidak ditampilkan. */
  share?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`text-gray-700 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className="flex items-baseline gap-2">
        {share && <span className="text-xs font-normal text-gray-400">{share}</span>}
        <span className={`text-red-600 ${bold ? 'font-bold' : ''}`}>
          {amount > 0 ? `- ${formatCurrency(amount)}` : '-'}
        </span>
      </span>
    </div>
  );
}
