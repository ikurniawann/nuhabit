// PATCH account/contact: hanya field yang dikirim yang berubah. Default skema
// create (account_type "corporate", is_primary false) tidak boleh ikut terisi.
import { describe, expect, it } from "vitest";
import { updateAccountSchema, updateContactSchema } from "./accounts";

describe("updateAccountSchema", () => {
  it("tidak mengisi account_type bila tidak dikirim", () => {
    expect(updateAccountSchema.parse({ city: "Bandung" })).toEqual({ city: "Bandung" });
  });

  it("account_type yang dikirim tetap divalidasi", () => {
    expect(updateAccountSchema.parse({ account_type: "sekolah" })).toEqual({ account_type: "sekolah" });
    expect(updateAccountSchema.safeParse({ account_type: "bukan" }).success).toBe(false);
  });

  it("key asing ditolak (strict)", () => {
    expect(updateAccountSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("updateContactSchema", () => {
  it("tidak mereset is_primary bila tidak dikirim", () => {
    expect(updateContactSchema.parse({ title: "Manager" })).toEqual({ title: "Manager" });
    expect(updateContactSchema.parse({ is_primary: false })).toEqual({ is_primary: false });
  });

  it("key asing ditolak (strict)", () => {
    expect(updateContactSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
