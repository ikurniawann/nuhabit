import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  hashSecret,
  normalizePhoneDigits,
  OTP_LENGTH,
} from "@/lib/member-portal/otp";

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
