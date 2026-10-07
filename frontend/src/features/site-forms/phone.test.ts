import { describe, expect, test } from "vitest";
import { COUNTRY_CODES, DEFAULT_COUNTRY, isE164, localDigits, toE164 } from "./phone";

describe("phone", () => {
  test("defaults to Indonesia and lists it first", () => {
    expect(DEFAULT_COUNTRY).toBe("ID");
    expect(COUNTRY_CODES[0]).toEqual({ code: "ID", dial: "+62", name: "Indonesia" });
    expect(COUNTRY_CODES.map((c) => c.code)).toEqual(expect.arrayContaining(["AU", "US", "GB", "SG", "MY"]));
  });

  test("strips separators and leading zeros from the local number", () => {
    expect(localDigits("0812-3456 7890")).toBe("81234567890");
    expect(localDigits("(0) 812")).toBe("812");
    expect(localDigits("")).toBe("");
  });

  test("joins the country code and local number into E.164", () => {
    expect(toE164("ID", "0812 3456 7890")).toBe("+6281234567890");
    expect(toE164("ID", "81234567890")).toBe("+6281234567890");
    expect(toE164("AU", "0412 345 678")).toBe("+61412345678");
    expect(toE164("US", "(212) 555-0100")).toBe("+12125550100");
    expect(toE164("GB", "07700 900123")).toBe("+447700900123");
  });

  test("does not double a country code already typed in the local number", () => {
    expect(toE164("ID", "+62 812 3456 7890")).toBe("+6281234567890");
    expect(toE164("ID", "6281234567890")).toBe("+6281234567890");
    // a leading 62 on a short number stays part of the number
    expect(toE164("SG", "62345678")).toBe("+6562345678");
  });

  test("rejects short, empty or unknown-country numbers", () => {
    expect(toE164("ID", "812")).toBeNull();
    expect(toE164("ID", "")).toBeNull();
    expect(toE164("XX", "81234567890")).toBeNull();
    expect(toE164("ID", "8123456789012345678")).toBeNull();
  });

  test("isE164 checks the final shape", () => {
    expect(isE164("+6281234567890")).toBe(true);
    expect(isE164("6281234567890")).toBe(false);
    expect(isE164("+0812")).toBe(false);
  });
});
