import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { EMAIL_IN_USE_MESSAGE, emailConflictOr } from "./email-conflict";

describe("emailConflictOr", () => {
  it("unique violation pada email (auth.users, users, employees) jadi 409", () => {
    for (const error of [
      { code: "23505", message: 'duplicate key value violates unique constraint "users_email_key"' },
      { code: "23505", message: "duplicate key", constraint: "employees_email_unique" },
    ]) {
      const mapped = emailConflictOr(error);
      expect(mapped).toBeInstanceOf(ApiError);
      expect((mapped as ApiError).status).toBe(409);
      expect(mapped.message).toBe(EMAIL_IN_USE_MESSAGE);
    }
  });

  it("unique violation kolom lain tetap Error biasa dengan kode pg", () => {
    const mapped = emailConflictOr({ code: "23505", message: 'unique constraint "employees_nip_key"' });
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect((mapped as Error & { code?: string }).code).toBe("23505");
  });

  it("Error asli dikembalikan apa adanya", () => {
    const original = new Error("boom");
    expect(emailConflictOr(original)).toBe(original);
  });
});
