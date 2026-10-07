import { describe, expect, test } from "vitest";
import { EMPTY_TRIAL, isTrialValid, trialPayload, validateTrial, type TrialValues } from "./trial-validation";

const filled: TrialValues = {
  ...EMPTY_TRIAL,
  branch_slug: "kemang",
  first_name: "Ani",
  last_name: "Budi",
  email: "ani@example.test",
  phone_local: "0812 3456 7890",
  consent_email: true,
};

describe("validateTrial", () => {
  test("isian kosong menyebut setiap field wajib", () => {
    expect(validateTrial(EMPTY_TRIAL)).toEqual({
      branch_slug: "Pilih cabang",
      first_name: "Nama depan wajib diisi",
      email: "Email wajib diisi",
      phone_local: "Nomor telepon wajib diisi",
    });
    expect(isTrialValid(EMPTY_TRIAL)).toBe(false);
  });

  test("isian lengkap lolos tanpa persetujuan pemasaran", () => {
    expect(validateTrial(filled)).toEqual({});
    expect(isTrialValid({ ...filled, consent_email: false, consent_sms: false })).toBe(true);
  });

  test("email dan nomor diperiksa bentuknya", () => {
    expect(validateTrial({ ...filled, email: "bukan-email" }).email).toBe("Email tidak valid");
    expect(validateTrial({ ...filled, phone_local: "812" }).phone_local).toBe("Nomor telepon tidak valid");
    expect(validateTrial({ ...filled, phone_country: "AU", phone_local: "0412 345 678" })).toEqual({});
  });

  test("nama dibatasi 80 karakter, nama belakang boleh kosong", () => {
    expect(validateTrial({ ...filled, last_name: "" })).toEqual({});
    expect(validateTrial({ ...filled, first_name: "a".repeat(81) }).first_name).toBe("Nama depan terlalu panjang");
  });

  test("payload membawa nomor E.164, UTM, halaman asal dan stempel mulai", () => {
    expect(trialPayload(filled, { utm: { utm_source: "ig" }, source_path: "/locations/kemang", form_started_at: 123 })).toEqual({
      branch_slug: "kemang",
      first_name: "Ani",
      last_name: "Budi",
      email: "ani@example.test",
      phone: "+6281234567890",
      consent_email: true,
      consent_sms: false,
      utm: { utm_source: "ig" },
      source_path: "/locations/kemang",
      form_started_at: 123,
    });
  });
});
