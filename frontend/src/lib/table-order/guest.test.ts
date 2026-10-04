import { describe, expect, it } from "vitest";
import { displayGuestPhone, normalizeGuestPhone, parseStoredGuest, validateGuest } from "./guest";

describe("data pemesan self-order", () => {
  it("normalisasi nomor WA Indonesia", () => {
    expect(normalizeGuestPhone("0812-3456-7890")).toBe("6281234567890");
    expect(normalizeGuestPhone("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalizeGuestPhone("81234567890")).toBe("6281234567890");
    expect(normalizeGuestPhone("0212345678")).toBeNull(); // telepon rumah, bukan ponsel
    expect(normalizeGuestPhone("0812")).toBeNull();
    expect(normalizeGuestPhone("")).toBeNull();
  });

  it("nama & nomor wajib", () => {
    expect(validateGuest({ name: "  Budi   Santoso ", phone: "08123456789" })).toEqual({
      ok: true,
      guest: { name: "Budi Santoso", phone: "628123456789" },
    });
    expect(validateGuest({ name: "Budi", phone: "123" })).toMatchObject({ ok: false });
    expect(validateGuest({ name: "B", phone: "08123456789" })).toMatchObject({ ok: false, error: expect.stringMatching(/nama/) });
  });

  it("tampilan tersamar & data tersimpan rusak diabaikan", () => {
    expect(displayGuestPhone("6281234567890")).toBe("0812-••••-7890");
    expect(parseStoredGuest('{"name":"Budi","phone":"081234567890"}')).toEqual({ name: "Budi", phone: "6281234567890" });
    expect(parseStoredGuest("{rusak")).toBeNull();
    expect(parseStoredGuest('{"name":"Budi"}')).toBeNull();
  });
});
