import { describe, it, expect } from "vitest";
import { buildPayrollRunCsv } from "./ui-run-csv";

describe("buildPayrollRunCsv", () => {
  it("writes the header and one line per employee", () => {
    const csv = buildPayrollRunCsv([
      {
        gross_salary: "5000000.00",
        total_deductions: 250000,
        net_salary: 4750000,
        pph21_deduction: 0,
        bpjs_tk_jht_deduction: 100000,
        bpjs_kes_deduction: 50000,
        employee: { nip: "EMP-1", full_name: "Budi", department: { name: "Bar" } },
      },
    ]);
    expect(csv.split("\n")).toEqual([
      "NIP,Nama Karyawan,Departemen,Gaji Kotor,Total Potongan,Gaji Bersih,PPh 21,BPJS TK,BPJS Kes",
      "EMP-1,Budi,Bar,5000000.00,250000,4750000,0,100000,50000",
    ]);
  });

  it("quotes cells with commas or quotes and tolerates a missing employee", () => {
    const csv = buildPayrollRunCsv([
      {
        gross_salary: 1,
        total_deductions: 0,
        net_salary: 1,
        pph21_deduction: 0,
        bpjs_tk_jht_deduction: 0,
        bpjs_kes_deduction: 0,
        employee: { nip: null, full_name: 'Siti, "Ani"', department: null },
      },
      {
        gross_salary: 2,
        total_deductions: 0,
        net_salary: 2,
        pph21_deduction: 0,
        bpjs_tk_jht_deduction: 0,
        bpjs_kes_deduction: 0,
      },
    ]);
    const [, first, second] = csv.split("\n");
    expect(first).toBe(',"Siti, ""Ani""",,1,0,1,0,0,0');
    expect(second).toBe(",,,2,0,2,0,0,0");
  });
});
