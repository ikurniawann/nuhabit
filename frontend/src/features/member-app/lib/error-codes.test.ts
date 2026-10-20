import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { CREDITS_HELD_MESSAGE, describeError, ERROR_MESSAGES } from "./error-codes";
import { fill, ID, type T } from "./i18n";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

const tFor =
  (lang: "id" | "en"): T =>
  (key, vars) => {
    const text = lang === "id" ? (ID[key] ?? key) : key;
    return vars ? fill(text, vars) : text;
  };

describe("server error codes", () => {
  const keys = [...Object.values(ERROR_MESSAGES), CREDITS_HELD_MESSAGE];

  it("has an Indonesian entry with the same placeholders for every message", () => {
    expect(keys.filter((key) => !(key in ID))).toEqual([]);
    expect(keys.filter((key) => key in ID && placeholders(ID[key]) !== placeholders(key))).toEqual([]);
  });

  it("maps a known code to the member's language with its numbers", () => {
    const daily = new ApiError(409, "Batas booking tercapai: maksimal 2 kelas per hari", "BOOKING_DAILY_LIMIT", { max: 2 });
    expect(describeError(daily, tFor("en"), "en", "Booking failed.")).toBe("Booking limit reached: up to 2 classes per day.");
    expect(describeError(daily, tFor("id"), "id", "Booking gagal.")).toBe("Batas booking tercapai: maksimal 2 kelas per hari.");
  });

  it("names the held credits only when other bookings hold some", () => {
    const held = new ApiError(409, "x", "BOOKING_INSUFFICIENT_CREDITS", { available: 1, needed: 2, reserved: 2 });
    expect(describeError(held, tFor("en"), "en", "")).toBe(
      "Not enough credits for this class: 1 available, 2 needed (2 held by other bookings)."
    );
    const plain = new ApiError(409, "x", "BOOKING_INSUFFICIENT_CREDITS", { available: 0, needed: 2, reserved: 0 });
    expect(describeError(plain, tFor("en"), "en", "")).toBe("Not enough credits for this class.");
  });

  it("formats a timestamp param in WIB", () => {
    const suspended = new ApiError(409, "x", "BOOKING_PASS_SUSPENDED", { until: "2026-10-23T03:00:00Z" });
    expect(describeError(suspended, tFor("en"), "en", "")).toMatch(/^Booking is paused until .*10:00/);
  });

  it("falls back to the server text, then to the caller's fallback", () => {
    expect(describeError(new ApiError(409, "Teks server", "SOMETHING_NEW"), tFor("en"), "en", "Failed")).toBe("Teks server");
    expect(describeError(new ApiError(500, "Teks server"), tFor("en"), "en", "Failed")).toBe("Teks server");
    expect(describeError(new Error("network"), tFor("en"), "en", "Failed")).toBe("Failed");
  });
});
