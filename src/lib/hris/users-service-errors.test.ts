import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { rethrowUserServiceError } from "./users-service-errors";

const caught = (error: unknown) => {
  try {
    rethrowUserServiceError(error);
  } catch (e) {
    return e;
  }
};

describe("rethrowUserServiceError", () => {
  it("pesan bisnis yang dikenal jadi 400 dengan pesan sama", () => {
    const e = caught(new Error("Employee not found"));
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(400);
    expect((e as ApiError).message).toBe("Employee not found");
  });

  it("galat lain dilempar ulang apa adanya", () => {
    const original = new Error('duplicate key value violates unique constraint "users_email_key"');
    expect(caught(original)).toBe(original);
    const apiError = ApiError.forbidden();
    expect(caught(apiError)).toBe(apiError);
  });
});
