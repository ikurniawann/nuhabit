import { describe, expect, test } from "vitest";
import { customerPatch, updateMemberSchema } from "./member-profile-server";

const parse = (customer: unknown) => customerPatch(updateMemberSchema.parse({ customer }).customer!);

describe("customerPatch", () => {
  test("email yang tidak dikirim tidak ikut di-update", () => {
    expect(parse({ name: "Ani" })).toEqual({ name: "Ani" });
  });

  test("email null atau kosong mengosongkan email", () => {
    expect(parse({ email: null })).toEqual({ email: null });
    expect(parse({ email: "" })).toEqual({ email: null });
  });

  test("email baru disimpan apa adanya", () => {
    expect(parse({ email: " ani@example.com " })).toEqual({ email: "ani@example.com" });
  });
});
