import { describe, expect, test } from "vitest";
import {
  addMonthsIso,
  buildContractNumber,
  computeKompensasi,
  draftContractFromEmploymentStatus,
  monthsWorked,
  PKWT_MAX_TOTAL_MONTHS,
  pkwtChainTotalMonths,
  romanMonth,
  validateContractDates,
  validatePkwtTotal,
} from "./contracts";

describe("monthsWorked", () => {
  test("counts whole calendar months", () => {
    expect(monthsWorked("2026-01-01", "2026-07-01")).toBe(6);
    expect(monthsWorked("2026-01-01", "2027-01-01")).toBe(12);
  });

  test("counts partial month as fraction of 30 days", () => {
    expect(monthsWorked("2026-01-15", "2026-01-30")).toBe(0.5);
    expect(monthsWorked("2026-01-01", "2026-01-16")).toBe(0.5);
  });

  test("returns 0 for invalid or reversed range", () => {
    expect(monthsWorked("2026-07-01", "2026-01-01")).toBe(0);
    expect(monthsWorked("not-a-date", "2026-01-01")).toBe(0);
  });
});

describe("computeKompensasi (PP 35/2021)", () => {
  test("12 bulan masa kerja = 1 bulan upah", () => {
    expect(computeKompensasi(4_800_000, "2026-01-01", "2027-01-01")).toBe(4_800_000);
  });

  test("pro-rata: 6 bulan = setengah bulan upah", () => {
    expect(computeKompensasi(4_800_000, "2026-01-01", "2026-07-01")).toBe(2_400_000);
  });

  test("masa kerja di bawah 1 bulan tidak berhak kompensasi", () => {
    expect(computeKompensasi(4_800_000, "2026-01-01", "2026-01-20")).toBe(0);
  });

  test("returns 0 when wage is missing or invalid", () => {
    expect(computeKompensasi(0, "2026-01-01", "2027-01-01")).toBe(0);
    expect(computeKompensasi(NaN, "2026-01-01", "2027-01-01")).toBe(0);
  });
});

describe("validateContractDates", () => {
  test("PKWT valid: punya tanggal berakhir, tanpa probation", () => {
    expect(
      validateContractDates({
        contract_type: "pkwt",
        start_date: "2026-08-01",
        end_date: "2027-08-01",
      })
    ).toEqual([]);
  });

  test("PKWT tanpa end_date ditolak", () => {
    const errors = validateContractDates({
      contract_type: "pkwt",
      start_date: "2026-08-01",
      end_date: null,
    });
    expect(errors.join(" ")).toContain("tanggal berakhir");
  });

  test("PKWT dengan masa percobaan ditolak (batal demi hukum)", () => {
    const errors = validateContractDates({
      contract_type: "pkwt",
      start_date: "2026-08-01",
      end_date: "2027-08-01",
      probation_end_date: "2026-11-01",
    });
    expect(errors.join(" ")).toContain("masa percobaan");
  });

  test("PKWTT valid: probation 3 bulan", () => {
    expect(
      validateContractDates({
        contract_type: "pkwtt",
        start_date: "2026-08-01",
        probation_end_date: "2026-11-01",
      })
    ).toEqual([]);
  });

  test("PKWTT probation lebih dari 3 bulan ditolak", () => {
    const errors = validateContractDates({
      contract_type: "pkwtt",
      start_date: "2026-08-01",
      probation_end_date: "2026-12-15",
    });
    expect(errors.join(" ")).toContain("maksimal 3 bulan");
  });

  test("tanggal berakhir sebelum mulai ditolak", () => {
    const errors = validateContractDates({
      contract_type: "pkwt",
      start_date: "2026-08-01",
      end_date: "2026-07-01",
    });
    expect(errors.join(" ")).toContain("setelah tanggal mulai");
  });

  test("tanggal mulai tidak valid ditolak", () => {
    const errors = validateContractDates({
      contract_type: "pkwtt",
      start_date: "bukan-tanggal",
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("pkwtChainTotalMonths / validatePkwtTotal", () => {
  test("menjumlahkan durasi seluruh rantai PKWT", () => {
    const total = pkwtChainTotalMonths([
      { start_date: "2024-01-01", end_date: "2025-01-01" },
      { start_date: "2025-01-01", end_date: "2026-01-01" },
    ]);
    expect(total).toBe(24);
  });

  test("total dalam batas 60 bulan lolos", () => {
    expect(validatePkwtTotal(48, 12)).toBeNull();
  });

  test("total melebihi 60 bulan ditolak dengan pesan batas 5 tahun", () => {
    const error = validatePkwtTotal(54, 12);
    expect(error).toContain("5 tahun");
    expect(PKWT_MAX_TOTAL_MONTHS).toBe(60);
  });
});

describe("draftContractFromEmploymentStatus", () => {
  test("'contract' → PKWT 12 bulan dari tanggal bergabung", () => {
    expect(draftContractFromEmploymentStatus("contract", "2026-08-01")).toEqual({
      contract_type: "pkwt",
      start_date: "2026-08-01",
      end_date: "2027-08-01",
      probation_end_date: null,
    });
  });

  test("'probation' → PKWTT dengan masa percobaan 3 bulan", () => {
    expect(draftContractFromEmploymentStatus("probation", "2026-08-01")).toEqual({
      contract_type: "pkwtt",
      start_date: "2026-08-01",
      end_date: null,
      probation_end_date: "2026-11-01",
    });
  });

  test("'permanent' → PKWTT tanpa masa percobaan", () => {
    expect(draftContractFromEmploymentStatus("permanent", "2026-08-01")).toEqual({
      contract_type: "pkwtt",
      start_date: "2026-08-01",
      end_date: null,
      probation_end_date: null,
    });
  });

  test("'internship' atau status tak dikenal → null (tidak dibuatkan kontrak)", () => {
    expect(draftContractFromEmploymentStatus("internship", "2026-08-01")).toBeNull();
    expect(draftContractFromEmploymentStatus("freelance", "2026-08-01")).toBeNull();
  });

  test("addMonthsIso menangani akhir bulan (31 Jan + 1 bulan = akhir Feb)", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("contract numbering", () => {
  test("romanMonth maps 1-12 to roman numerals", () => {
    expect(romanMonth(1)).toBe("I");
    expect(romanMonth(7)).toBe("VII");
    expect(romanMonth(12)).toBe("XII");
  });

  test("buildContractNumber formats seq/type/roman-month/year", () => {
    expect(buildContractNumber("pkwt", 1, new Date("2026-07-16"))).toBe("0001/PKWT/VII/2026");
    expect(buildContractNumber("pkwtt", 42, new Date("2026-12-01"))).toBe(
      "0042/PKWTT/XII/2026"
    );
  });
});
