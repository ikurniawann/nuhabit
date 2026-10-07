import { describe, expect, it } from "vitest";
import { candidatesCsv, csvCell, recruitmentDashboardCsv, type CandidateCsvRow } from "./candidate-csv";

const row: CandidateCsvRow = {
  full_name: 'Sari "Ayu"',
  email: "sari@contoh.com",
  phone: "+62812",
  domicile: "Bandung",
  status: "screening",
  source: "walk_in",
  created_at: "2026-10-04T03:00:00Z",
  brands: { name: "Kopi A" },
  positions: null,
};

describe("csvCell", () => {
  it("doubles quotes and neutralises spreadsheet formulas", () => {
    expect(csvCell('Budi "B"')).toBe('"Budi ""B"""');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+62812")).toBe("\"'+62812\"");
    expect(csvCell(null)).toBe('""');
  });
});

describe("candidatesCsv", () => {
  it("memakai label status/sumber dan tanggal WIB", () => {
    const [header, line] = candidatesCsv([row]).split("\n");
    expect(header).toContain('"Nama","Email"');
    expect(line).toBe(
      `"Sari ""Ayu""","sari@contoh.com","'+62812","Bandung","","Kopi A","Screening","Walk-in","4 Okt 2026"`
    );
  });
});

describe("recruitmentDashboardCsv", () => {
  it("mengisi posisi & brand dari relasi bersarang", () => {
    const [, line] = recruitmentDashboardCsv([{ ...row, positions: { title: "Barista" } }]).split("\n");
    expect(line).toBe(`"Sari ""Ayu""","Barista","Kopi A","screening","walk_in","4 Okt 2026"`);
  });
});
