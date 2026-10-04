import { describe, expect, it } from "vitest";
import { isValidBirthDate, localPhoneFormat, validateRegistration } from "./register";

const TODAY = new Date("2026-10-04T00:00:00Z");

describe("validateRegistration", () => {
  it("menormalkan nomor, nama, dan email", () => {
    const result = validateRegistration(
      { phone: "0812-3456-7890", name: "  Sari   Dewi ", email: " Sari@Mail.COM ", wa_consent: true },
      TODAY
    );
    expect(result).toEqual({
      ok: true,
      value: {
        phoneDigits: "6281234567890",
        phoneLocal: "081234567890",
        name: "Sari Dewi",
        email: "sari@mail.com",
        birthDate: null,
        waConsent: true,
      },
    });
  });

  it("email dan tanggal lahir opsional; consent hanya true bila dicentang", () => {
    const result = validateRegistration({ phone: "+62 812 3456 7890", name: "Budi", email: "", birth_date: "" }, TODAY);
    expect(result.ok && result.value).toMatchObject({ email: null, birthDate: null, waConsent: false });
  });

  it("menolak nomor, nama, email, dan tanggal lahir yang salah", () => {
    expect(validateRegistration({ phone: "0812", name: "Budi" }, TODAY)).toMatchObject({ ok: false, field: "phone" });
    expect(validateRegistration({ phone: "081234567890", name: " B " }, TODAY)).toMatchObject({ ok: false, field: "name" });
    expect(validateRegistration({ phone: "081234567890", name: "x".repeat(101) }, TODAY)).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(validateRegistration({ phone: "081234567890", name: "Budi", email: "budi@" }, TODAY)).toMatchObject({
      ok: false,
      field: "email",
    });
    expect(
      validateRegistration({ phone: "081234567890", name: "Budi", birth_date: "2026-02-30" }, TODAY)
    ).toMatchObject({ ok: false, field: "birth_date" });
  });

  it("menolak masukan bukan string", () => {
    expect(validateRegistration({ phone: 812345678, name: "Budi" }, TODAY)).toMatchObject({ ok: false, field: "phone" });
    expect(validateRegistration({ phone: "081234567890", name: null }, TODAY)).toMatchObject({ ok: false, field: "name" });
  });
});

describe("isValidBirthDate", () => {
  it("umur wajar 5-120 tahun dan tanggal kalender nyata", () => {
    expect(isValidBirthDate("1990-05-17", TODAY)).toBe(true);
    expect(isValidBirthDate("2024-01-01", TODAY)).toBe(false);
    expect(isValidBirthDate("1890-01-01", TODAY)).toBe(false);
    expect(isValidBirthDate("1990-13-01", TODAY)).toBe(false);
    expect(isValidBirthDate("17-05-1990", TODAY)).toBe(false);
  });
});

describe("localPhoneFormat", () => {
  it("62xxx menjadi 0xxx, nomor luar negeri tetap", () => {
    expect(localPhoneFormat("6281234567890")).toBe("081234567890");
    expect(localPhoneFormat("6512345678")).toBe("6512345678");
  });
});
