import { describe, expect, test } from "vitest";
import { COUNTRY_CODES, DEFAULT_COUNTRY, isE164, localDigits, toE164 } from "./phone";

describe("phone", () => {
  test("Indonesia jadi bawaan dan ada di daftar", () => {
    expect(DEFAULT_COUNTRY).toBe("ID");
    expect(COUNTRY_CODES[0]).toEqual({ code: "ID", dial: "+62", name: "Indonesia" });
    expect(COUNTRY_CODES.map((c) => c.code)).toEqual(expect.arrayContaining(["AU", "US", "GB", "SG", "MY"]));
  });

  test("nomor lokal dibersihkan dari pemisah dan nol awal", () => {
    expect(localDigits("0812-3456 7890")).toBe("81234567890");
    expect(localDigits("(0) 812")).toBe("812");
    expect(localDigits("")).toBe("");
  });

  test("gabungan kode negara dan nomor lokal menjadi E.164", () => {
    expect(toE164("ID", "0812 3456 7890")).toBe("+6281234567890");
    expect(toE164("ID", "81234567890")).toBe("+6281234567890");
    expect(toE164("AU", "0412 345 678")).toBe("+61412345678");
    expect(toE164("US", "(212) 555-0100")).toBe("+12125550100");
    expect(toE164("GB", "07700 900123")).toBe("+447700900123");
  });

  test("kode negara yang sudah diketik di nomor lokal tidak digandakan", () => {
    expect(toE164("ID", "+62 812 3456 7890")).toBe("+6281234567890");
    expect(toE164("ID", "6281234567890")).toBe("+6281234567890");
    // 62 di awal nomor pendek tetap bagian nomor
    expect(toE164("SG", "62345678")).toBe("+6562345678");
  });

  test("nomor pendek, kosong, atau negara tak dikenal ditolak", () => {
    expect(toE164("ID", "812")).toBeNull();
    expect(toE164("ID", "")).toBeNull();
    expect(toE164("XX", "81234567890")).toBeNull();
    expect(toE164("ID", "8123456789012345678")).toBeNull();
  });

  test("isE164 memeriksa bentuk akhir", () => {
    expect(isE164("+6281234567890")).toBe(true);
    expect(isE164("6281234567890")).toBe(false);
    expect(isE164("+0812")).toBe(false);
  });
});
