import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  hashSecret,
  normalizePhoneDigits,
  OTP_LENGTH,
} from "@/lib/member-portal/otp";
import {
  computeProfileCompletion,
  type MemberProfileFields,
} from "@/lib/member-portal/profile";

describe("normalizePhoneDigits", () => {
  it("0812... → 62812...", () => {
    expect(normalizePhoneDigits("0812-3456-789")).toBe("628123456789");
  });
  it("sudah 62 → tetap", () => {
    expect(normalizePhoneDigits("+62 812 3456 789")).toBe("628123456789");
  });
  it("kosong/terlalu pendek/panjang → null", () => {
    expect(normalizePhoneDigits("")).toBeNull();
    expect(normalizePhoneDigits("0812")).toBeNull();
    expect(normalizePhoneDigits("628123456789012345")).toBeNull();
  });
});

describe("generateOtpCode / hashSecret", () => {
  it("selalu 6 digit", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateOtpCode()).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    }
  });
  it("hash deterministik & bukan plaintext", () => {
    expect(hashSecret("123456")).toBe(hashSecret("123456"));
    expect(hashSecret("123456")).not.toContain("123456");
  });
});

describe("computeProfileCompletion", () => {
  const full: MemberProfileFields = {
    name: "Wahyu",
    phone: "628123456789",
    email: "w@x.id",
    birth_date: "2000-01-01",
    gender: "male",
    city: "Bandung",
    photo_url: "/foto.jpg",
    wa_consent: false, // sudah MEMILIH (walau menolak) = terisi
  };

  it("semua terisi → 100% complete (consent false tetap dihitung terisi)", () => {
    const result = computeProfileCompletion(full);
    expect(result.percent).toBe(100);
    expect(result.complete).toBe(true);
  });

  it("field kosong mengurangi persen & masuk daftar missing", () => {
    const result = computeProfileCompletion({
      ...full,
      city: "",
      photo_url: null,
      wa_consent: null,
    });
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(["city", "photo_url", "wa_consent"])
    );
    expect(result.percent).toBe(Math.round((5 / 8) * 100));
  });
});
