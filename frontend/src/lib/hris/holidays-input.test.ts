import { describe, expect, it } from "vitest";
import {
  defaultDeductsLeave,
  holidayTypeOrDefault,
  resolveHolidayRange,
  resolveImportYear,
  validateHolidayBody,
  validateHolidayPatch,
  validateImportItem,
} from "./holidays-input";

describe("validateHolidayBody (POST)", () => {
  it.each([
    [{ name: "HUT RI" }, "Tanggal wajib diisi (YYYY-MM-DD)"],
    [{ holiday_date: "2026-13-45", name: "X" }, "Tanggal tidak valid"],
    [{ holiday_date: "2026-08-17", name: " " }, "Nama libur wajib diisi"],
    [{ holiday_date: "2026-08-17", name: "HUT", type: "regional" }, "Tipe libur tidak valid"],
    [{ holiday_date: "2026-08-17", name: "HUT", status: "batal" }, "Status tidak valid"],
  ])("%o → %s", (body, message) => {
    expect(validateHolidayBody(body)).toBe(message);
  });
  it("body lengkap lolos", () => {
    expect(validateHolidayBody({ holiday_date: "2026-08-17", name: "HUT RI", type: "nasional" })).toBeNull();
  });
});

describe("validateHolidayPatch", () => {
  it("hanya field yang dikirim yang dicek", () => {
    expect(validateHolidayPatch({})).toBeNull();
    expect(validateHolidayPatch({ holiday_date: "17/08/2026" })).toBe("Tanggal tidak valid (YYYY-MM-DD)");
    expect(validateHolidayPatch({ name: "" })).toBe("Nama libur wajib diisi");
  });
});

describe("validateImportItem", () => {
  it("tanggal & nama wajib", () => {
    expect(validateImportItem({ name: "X" })).toBe("Tanggal tidak valid");
    expect(validateImportItem({ holiday_date: "2026-01-01" })).toBe("Nama libur wajib diisi");
    expect(validateImportItem({ holiday_date: "2026-01-01", name: "Tahun Baru" })).toBeNull();
  });
});

describe("aturan tipe", () => {
  it("hanya cuti bersama yang memotong cuti; tipe tak dikenal jadi nasional", () => {
    expect(defaultDeductsLeave("cuti_bersama")).toBe(true);
    expect(defaultDeductsLeave("nasional")).toBe(false);
    expect(holidayTypeOrDefault(undefined)).toBe("nasional");
    expect(holidayTypeOrDefault("perusahaan")).toBe("perusahaan");
  });
});

describe("resolveHolidayRange", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  it("default satu tahun berjalan", () => {
    expect(resolveHolidayRange(new URLSearchParams(), now)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
  it("tahun eksplisit", () => {
    expect(resolveHolidayRange(new URLSearchParams("year=2027"), now)).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
  });
  it("rentang wajib lengkap", () => {
    expect(resolveHolidayRange(new URLSearchParams("start_date=2026-01-01"), now)).toBeNull();
    expect(resolveHolidayRange(new URLSearchParams("start_date=2026-01-01&end_date=2026-01-31"), now)).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });
  it("tahun impor salah format jatuh ke tahun berjalan", () => {
    expect(resolveImportYear("20xx", now)).toBe(2026);
    expect(resolveImportYear("2027", now)).toBe(2027);
  });
});
