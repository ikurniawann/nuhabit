import { describe, expect, it } from "vitest";
import {
  EMPTY_CONTRACT_FORM,
  contractAdminFormFromRow,
  contractActionMessage,
  contractAdminPayload,
  contractFormFromRow,
  contractFormPayload,
  toDateInput,
} from "./employee-profile-contracts";

const row = {
  contract_type: "pkwt" as const,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  probation_end_date: null,
  work_location: null,
  base_salary: "4500000.00",
  notes: null,
  signed_at: "2026-01-01T17:30:00.000Z",
  kemnaker_registered_at: null,
  compensation_paid_at: null,
};

describe("toDateInput", () => {
  it("tanggal kalender tidak digeser", () => {
    expect(toDateInput("2026-03-01")).toBe("2026-03-01");
  });
  it("timestamp dibaca di kalender WIB", () => {
    expect(toDateInput("2026-01-01T17:30:00.000Z")).toBe("2026-01-02");
  });
  it("kosong atau rusak → string kosong", () => {
    expect(toDateInput(null)).toBe("");
    expect(toDateInput("bukan tanggal")).toBe("");
  });
});

describe("contractFormFromRow", () => {
  it("mengisi form dari baris kontrak", () => {
    expect(contractFormFromRow(row)).toEqual({
      contract_type: "pkwt",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      probation_end_date: "",
      work_location: "",
      base_salary: "4500000",
      notes: "",
    });
  });
});

describe("contractFormPayload", () => {
  it("PKWT: kirim tanggal berakhir, buang probation", () => {
    const payload = contractFormPayload({
      ...EMPTY_CONTRACT_FORM,
      start_date: "2026-01-01",
      end_date: "2026-06-30",
      probation_end_date: "2026-03-31",
      base_salary: "5000000",
    });
    expect(payload).toEqual({
      start_date: "2026-01-01",
      end_date: "2026-06-30",
      probation_end_date: null,
      work_location: null,
      base_salary: 5000000,
      notes: null,
    });
  });

  it("PKWTT: kirim probation, buang tanggal berakhir", () => {
    const payload = contractFormPayload({
      ...EMPTY_CONTRACT_FORM,
      contract_type: "pkwtt",
      start_date: "2026-01-01",
      end_date: "2026-06-30",
      probation_end_date: "2026-03-31",
      work_location: "Jakarta",
    });
    expect(payload).toMatchObject({
      end_date: null,
      probation_end_date: "2026-03-31",
      work_location: "Jakarta",
      base_salary: null,
    });
  });
});

describe("form administrasi", () => {
  it("round-trip: tanggal kosong jadi null", () => {
    const form = contractAdminFormFromRow(row);
    expect(form).toEqual({
      signed_at: "2026-01-02",
      kemnaker_registered_at: "",
      compensation_paid_at: "",
    });
    expect(contractAdminPayload(form)).toEqual({
      signed_at: "2026-01-02",
      kemnaker_registered_at: null,
      compensation_paid_at: null,
    });
  });
});

describe("contractActionMessage", () => {
  it("menambahkan uang kompensasi bila ada", () => {
    expect(
      contractActionMessage({
        message: "Kontrak diakhiri",
        compensation_amount: 4500000,
      })
    ).toBe("Kontrak diakhiri — uang kompensasi Rp4.500.000");
  });
  it("tanpa kompensasi: pesan apa adanya", () => {
    expect(
      contractActionMessage({
        message: "Kontrak diaktifkan",
        compensation_amount: 0,
      })
    ).toBe("Kontrak diaktifkan");
    expect(contractActionMessage({ message: "Kontrak diaktifkan" })).toBe("Kontrak diaktifkan");
  });
});
