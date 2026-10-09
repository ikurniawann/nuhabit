import type ExcelJS from "exceljs";
import type { PayrollRunDetail, PayrollRunDetailRow } from "@/features/hris/payroll/types";

const FOREST = "FF00281A";
const LIME = "FFDAFF59";
const MUTED = "FF5F6D65";
const LIGHT = "FFF5ECE2";
const MONEY_FORMAT = '"Rp" #,##0.00;[Red]("Rp" #,##0.00)';

const COLUMNS = [
  ["NIP", 17], ["Nama Karyawan", 25], ["Departemen", 20], ["Bank (HRIS)", 16], ["No. Rekening (HRIS)", 23],
  ["Gaji Pokok", 18], ["Tunjangan Tetap", 18], ["Tunjangan Variabel", 18], ["Transport", 16],
  ["Makan", 16], ["Tempat Tinggal", 18], ["Lembur", 16], ["THR", 16], ["Bonus", 16],
  ["Pendapatan Lain", 18], ["Bruto", 18], ["BPJS TK JHT", 17], ["BPJS TK JP", 17],
  ["BPJS Kesehatan", 18], ["Tapera", 16], ["PPh 21", 16], ["Cuti Tanpa Bayar", 20],
  ["Keterlambatan", 18], ["Cicilan Pinjaman", 19], ["Potongan Lain", 18],
  ["Total Potongan", 19], ["Net Transfer", 19], ["Selisih Cek", 17],
] as const;

const MONEY_KEYS = [
  "base_salary", "fixed_allowance", "variable_allowance", "transport_allowance", "meal_allowance",
  "housing_allowance", "overtime_pay", "thr", "bonus", "other_earning", "gross_salary",
  "bpjs_tk_jht_deduction", "bpjs_tk_jp_deduction", "bpjs_kes_deduction", "tapera_deduction",
  "pph21_deduction", "unpaid_leave_deduction", "late_deduction", "loan_deduction",
  "other_deduction", "total_deductions", "net_salary",
] as const satisfies readonly (keyof PayrollRunDetailRow)[];

function amount(value: number | string | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sum(rows: readonly PayrollRunDetailRow[], key: "gross_salary" | "total_deductions" | "net_salary") {
  return Math.round(rows.reduce((total, row) => total + amount(row[key]), 0) * 100) / 100;
}

function periodLabel(month: number, year: number): string {
  const monthName = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][month - 1];
  return `${monthName ?? month} ${year}`;
}

/** Format kerja NüHabit. Data berasal dari snapshot payroll, bukan file instruksi bank. */
export async function buildPayrollRunWorkbook(run: PayrollRunDetail): Promise<ExcelJS.Workbook> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "NüHabit";
  workbook.calcProperties.fullCalcOnLoad = true;
  const details = run.payroll_details ?? [];
  const summary = workbook.addWorksheet("Ringkasan");
  const detail = workbook.addWorksheet("Rincian", { views: [{ state: "frozen", ySplit: 6, xSplit: 5 }] });
  COLUMNS.forEach(([, width], index) => { detail.getColumn(index + 1).width = width; });
  detail.mergeCells(1, 1, 1, COLUMNS.length);
  detail.getCell("A1").value = "NüHabit · Rincian Penggajian";
  detail.getCell("A1").font = { name: "Outfit", size: 16, bold: true, color: { argb: FOREST } };
  detail.getCell("A2").value = `Periode: ${periodLabel(run.period_month, run.period_year)}`;
  detail.getCell("A3").value = `Run: ${run.run_name} · Status: ${run.status}`;
  detail.getCell("A4").value = "Draf internal. Rekening diambil dari profil HRIS saat export; verifikasi sebelum transfer.";
  detail.getCell("A4").font = { name: "Manrope", color: { argb: MUTED }, italic: true };

  const header = detail.getRow(6);
  COLUMNS.forEach(([name], index) => {
    const cell = header.getCell(index + 1);
    cell.value = name;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOREST } };
    cell.font = { name: "Manrope", bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  header.height = 32;

  details.forEach((row, index) => {
    const rowNumber = index + 7;
    const excelRow = detail.getRow(rowNumber);
    const person = row.employee;
    [person?.nip ?? "", person?.full_name ?? "", person?.department?.name ?? "", person?.bank_name ?? "", person?.bank_account ?? ""]
      .forEach((value, column) => {
        const cell = excelRow.getCell(column + 1);
        cell.value = String(value);
        cell.numFmt = "@";
      });
    MONEY_KEYS.forEach((key, indexMoney) => {
      const cell = excelRow.getCell(indexMoney + 6);
      cell.value = amount(row[key]);
      cell.numFmt = MONEY_FORMAT;
    });
    const difference = Math.round((amount(row.gross_salary) - amount(row.total_deductions) - amount(row.net_salary)) * 100) / 100;
    const check = excelRow.getCell(28);
    check.value = { formula: `ROUND(P${rowNumber}-Z${rowNumber}-AA${rowNumber},2)`, result: difference };
    check.numFmt = MONEY_FORMAT;
    if (difference !== 0) check.font = { color: { argb: "FFB91C1C" }, bold: true };
    if (index % 2 === 1) {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      });
    }
  });

  detail.autoFilter = { from: { row: 6, column: 1 }, to: { row: Math.max(6, details.length + 6), column: COLUMNS.length } };
  summary.getColumn(1).width = 36;
  summary.getColumn(2).width = 25;
  summary.getColumn(3).width = 56;
  summary.mergeCells("A1:C1");
  summary.getCell("A1").value = "NüHabit · Rekap Penggajian";
  summary.getCell("A1").font = { name: "Outfit", size: 17, bold: true, color: { argb: FOREST } };
  summary.getCell("A3").value = "Periode";
  summary.getCell("B3").value = periodLabel(run.period_month, run.period_year);
  summary.getCell("A4").value = "Status run";
  summary.getCell("B4").value = run.status;
  summary.getCell("A6").value = "Jumlah karyawan";
  summary.getCell("B6").value = details.length;
  const lastRow = details.length + 6;
  const totals = [
    [7, "Total bruto", "P", "gross_salary"],
    [8, "Total potongan", "Z", "total_deductions"],
    [9, "Total net transfer", "AA", "net_salary"],
  ] as const;
  for (const [rowNumber, label, letter, key] of totals) {
    summary.getCell(`A${rowNumber}`).value = label;
    summary.getCell(`B${rowNumber}`).value = details.length
      ? { formula: `SUM(Rincian!${letter}7:${letter}${lastRow})`, result: sum(details, key) }
      : 0;
    summary.getCell(`B${rowNumber}`).numFmt = MONEY_FORMAT;
  }
  summary.getCell("A10").value = "Selisih total";
  summary.getCell("B10").value = {
    formula: "ROUND(B7-B8-B9,2)",
    result: Math.round((sum(details, "gross_salary") - sum(details, "total_deductions") - sum(details, "net_salary")) * 100) / 100,
  };
  summary.getCell("B10").numFmt = MONEY_FORMAT;
  for (const column of [1, 2]) {
    const cell = summary.getRow(9).getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIME } };
    cell.font = { name: "Manrope", bold: true, color: { argb: FOREST } };
  }
  const missingBank = details.filter((row) => !row.employee?.bank_name?.trim() || !row.employee?.bank_account?.trim()).length;
  const mismatch = details.filter((row) => Math.abs(amount(row.gross_salary) - amount(row.total_deductions) - amount(row.net_salary)) >= 0.01).length;
  summary.getCell("A12").value = "Rekening belum lengkap";
  summary.getCell("B12").value = missingBank;
  summary.getCell("A13").value = "Selisih perhitungan";
  summary.getCell("B13").value = mismatch;
  summary.mergeCells("A15:C15");
  summary.getCell("A15").value = "Draf internal, bukan instruksi transfer bank. Rekening berasal dari profil HRIS saat export; cocokkan sebelum pembayaran.";
  summary.getCell("A15").font = { name: "Manrope", color: { argb: MUTED }, italic: true };
  summary.getCell("A15").alignment = { wrapText: true };
  summary.getRow(15).height = 34;
  if (run.status !== "paid") {
    summary.mergeCells("A16:C16");
    summary.getCell("A16").value = "Run belum berstatus paid; angka payroll masih dapat berubah.";
    summary.getCell("A16").font = { name: "Manrope", bold: true, color: { argb: "FFB91C1C" } };
  }
  return workbook;
}
