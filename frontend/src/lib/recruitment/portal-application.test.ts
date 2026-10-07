import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { parseApplicationFields } from "./portal-application";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const complete = {
  full_name: "Budi",
  email: "budi@contoh.com",
  phone: "081234567890",
  domicile: "Bandung",
  source: "portal",
};

const messageOf = (fields: Record<string, string>) => {
  try {
    parseApplicationFields(form(fields));
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return (e as ApiError).message;
  }
  return null;
};

describe("parseApplicationFields", () => {
  it("field wajib kosong didahulukan dari galat format email", () => {
    expect(messageOf({ ...complete, email: "bukan-email", phone: "" })).toBe("Required fields are missing");
  });

  it("email tidak valid", () => {
    expect(messageOf({ ...complete, email: 'x"@evil' })).toBe("Invalid email format");
  });

  it("opsional kosong jadi null, gaji jadi angka", () => {
    const input = parseApplicationFields(form({ ...complete, notes: "", expected_salary: "5000000" }));
    expect(input.notes).toBeNull();
    expect(input.position_id).toBeNull();
    expect(input.expected_salary).toBe(5_000_000);
    expect(parseApplicationFields(form({ ...complete, expected_salary: "abc" })).expected_salary).toBeNull();
  });
});
