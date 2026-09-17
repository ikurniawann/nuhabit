"use client";

import React from "react";
import {
  loanInstallmentLabel,
  type LoanInstallmentDetail,
} from "@/lib/payroll/loans";

interface PayslipData {
  employee: {
    full_name: string;
    nip: string;
    department?: {
      name: string;
    };
  };
  payroll_run: {
    run_name: string;
    period_month: number;
    period_year: number;
  };
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  overtime_pay: number;
  thr: number;
  bonus: number;
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
  total_deductions: number;
  net_salary: number;
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

interface PayslipPDFProps {
  data: PayslipData;
}

export function PayslipPDF({ data }: PayslipPDFProps) {
  const totalEarnings = data.gross_salary;
  const totalDeductions = data.total_deductions;

  return (
    <div className="bg-white p-8 max-w-2xl mx-auto" id="payslip-content">
      {/* Header */}
      <div className="border-b-2 border-pink-600 pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-pink-600">BCD COFFEE OS</h1>
            <p className="text-sm text-gray-500">Slip Gaji Karyawan</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{data.payroll_run.run_name}</p>
            <p className="text-xs text-gray-500">
              {getMonthName(data.payroll_run.period_month)} {data.payroll_run.period_year}
            </p>
          </div>
        </div>
      </div>

      {/* Employee Info */}
      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
        <div>
          <p className="text-gray-500">Nama</p>
          <p className="font-medium">{data.employee.full_name}</p>
        </div>
        <div>
          <p className="text-gray-500">NIP</p>
          <p className="font-medium">{data.employee.nip}</p>
        </div>
        <div>
          <p className="text-gray-500">Departemen</p>
          <p className="font-medium">{data.employee.department?.name || "-"}</p>
        </div>
        <div>
          <p className="text-gray-500">Tanggal Cetak</p>
          <p className="font-medium">{new Date().toLocaleDateString("id-ID")}</p>
        </div>
      </div>

      {/* Earnings */}
      <div className="mb-6">
        <h3 className="font-bold text-pink-600 mb-3 border-b">PENGHASILAN</h3>
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="py-2">Gaji Pokok</td>
              <td className="text-right font-medium">{formatCurrency(data.base_salary)}</td>
            </tr>
            {data.fixed_allowance > 0 && (
              <tr>
                <td className="py-2">Tunjangan Tetap</td>
                <td className="text-right font-medium">{formatCurrency(data.fixed_allowance)}</td>
              </tr>
            )}
            {data.variable_allowance > 0 && (
              <tr>
                <td className="py-2">Tunjangan Tidak Tetap</td>
                <td className="text-right font-medium">{formatCurrency(data.variable_allowance)}</td>
              </tr>
            )}
            {data.transport_allowance > 0 && (
              <tr>
                <td className="py-2">Tunjangan Transport</td>
                <td className="text-right font-medium">{formatCurrency(data.transport_allowance)}</td>
              </tr>
            )}
            {data.meal_allowance > 0 && (
              <tr>
                <td className="py-2">Tunjangan Makan</td>
                <td className="text-right font-medium">{formatCurrency(data.meal_allowance)}</td>
              </tr>
            )}
            {data.housing_allowance > 0 && (
              <tr>
                <td className="py-2">Tunjangan Perumahan</td>
                <td className="text-right font-medium">{formatCurrency(data.housing_allowance)}</td>
              </tr>
            )}
            {data.overtime_pay > 0 && (
              <tr>
                <td className="py-2">Lembur</td>
                <td className="text-right font-medium">{formatCurrency(data.overtime_pay)}</td>
              </tr>
            )}
            {data.thr > 0 && (
              <tr>
                <td className="py-2">THR</td>
                <td className="text-right font-medium">{formatCurrency(data.thr)}</td>
              </tr>
            )}
            {data.bonus > 0 && (
              <tr>
                <td className="py-2">Bonus</td>
                <td className="text-right font-medium">{formatCurrency(data.bonus)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-pink-600">
              <td className="py-3 font-bold">Total Penghasilan</td>
              <td className="text-right font-bold">{formatCurrency(totalEarnings)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Deductions */}
      <div className="mb-6">
        <h3 className="font-bold text-red-600 mb-3 border-b">POTONGAN</h3>
        <table className="w-full text-sm">
          <tbody>
            {data.bpjs_tk_jht_deduction > 0 && (
              <tr>
                <td className="py-2">BPJS TK (JHT 2%)</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.bpjs_tk_jht_deduction)}
                </td>
              </tr>
            )}
            {data.bpjs_tk_jp_deduction > 0 && (
              <tr>
                <td className="py-2">BPJS TK (JP 1%)</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.bpjs_tk_jp_deduction)}
                </td>
              </tr>
            )}
            {data.bpjs_kes_deduction > 0 && (
              <tr>
                <td className="py-2">BPJS Kesehatan (1%)</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.bpjs_kes_deduction)}
                </td>
              </tr>
            )}
            {data.tapera_deduction > 0 && (
              <tr>
                <td className="py-2">Tapera (2.5%)</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.tapera_deduction)}
                </td>
              </tr>
            )}
            {data.pph21_deduction > 0 && (
              <tr>
                <td className="py-2">PPh 21</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.pph21_deduction)}
                </td>
              </tr>
            )}
            {data.unpaid_leave_deduction > 0 && (
              <tr>
                <td className="py-2">Cuti Tanpa Upah</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.unpaid_leave_deduction)}
                </td>
              </tr>
            )}
            {(data.late_deduction ?? 0) > 0 && (
              <tr>
                <td className="py-2">Potongan Keterlambatan</td>
                <td className="text-right font-medium text-red-600">
                  {formatCurrency(data.late_deduction ?? 0)}
                </td>
              </tr>
            )}
            {(data.loan_details?.length ?? 0) > 0
              ? data.loan_details!.map((loan) => (
                  <tr key={loan.loan_id}>
                    <td className="py-2">{loanInstallmentLabel(loan)}</td>
                    <td className="text-right font-medium text-red-600">
                      {formatCurrency(loan.amount)}
                    </td>
                  </tr>
                ))
              : (data.loan_deduction ?? 0) > 0 && (
                  <tr>
                    <td className="py-2">Cicilan Pinjaman</td>
                    <td className="text-right font-medium text-red-600">
                      {formatCurrency(data.loan_deduction ?? 0)}
                    </td>
                  </tr>
                )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-red-600">
              <td className="py-3 font-bold">Total Potongan</td>
              <td className="text-right font-bold text-red-600">
                {formatCurrency(totalDeductions)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Net Salary */}
      <div className="bg-pink-50 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Take Home Pay</p>
            <p className="text-2xl font-bold text-pink-600">{formatCurrency(data.net_salary)}</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>Gaji Kotor - Total Potongan</p>
            <p>{formatCurrency(totalEarnings)} - {formatCurrency(totalDeductions)}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t pt-4 text-xs text-gray-500 text-center">
        <p>Dokumen ini dibuat secara otomatis dan sah tanpa tanda tangan.</p>
        <p>Untuk pertanyaan, hubungi HRD.</p>
      </div>
    </div>
  );
}
