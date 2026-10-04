/** CSV ringkas detail run payroll (tombol "Export CSV" di halaman detail run). */

export interface PayrollCsvRow {
  gross_salary: number | string;
  total_deductions: number | string;
  net_salary: number | string;
  pph21_deduction: number | string;
  bpjs_tk_jht_deduction: number | string;
  bpjs_kes_deduction: number | string;
  employee?: { nip?: string | null; full_name?: string | null; department?: { name?: string | null } | null } | null;
}

const HEADERS = [
  "NIP",
  "Nama Karyawan",
  "Departemen",
  "Gaji Kotor",
  "Total Potongan",
  "Gaji Bersih",
  "PPh 21",
  "BPJS TK",
  "BPJS Kes",
];

/** Kutip sel yang mengandung koma, kutip, atau baris baru (RFC 4180). */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildPayrollRunCsv(rows: readonly PayrollCsvRow[]): string {
  const lines = rows.map((d) =>
    [
      d.employee?.nip || "",
      d.employee?.full_name || "",
      d.employee?.department?.name || "",
      d.gross_salary,
      d.total_deductions,
      d.net_salary,
      d.pph21_deduction,
      d.bpjs_tk_jht_deduction,
      d.bpjs_kes_deduction,
    ]
      .map(csvCell)
      .join(",")
  );
  return [HEADERS.join(","), ...lines].join("\n");
}
