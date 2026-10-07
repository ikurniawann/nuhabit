import { describe, expect, it } from "vitest";
import { bearerTokenFromAuthHeader } from "./session";

/**
 * EPIC-044 — parser header Authorization Bearer utk klien mobile app.
 * Pure function: tidak sentuh DB maupun next/headers.
 */
describe("bearerTokenFromAuthHeader", () => {
  it("mengambil token dari format standar 'Bearer <token>'", () => {
    expect(bearerTokenFromAuthHeader("Bearer abc123")).toBe("abc123");
  });

  it("tidak peduli kapitalisasi kata Bearer dan spasi berlebih", () => {
    expect(bearerTokenFromAuthHeader("bearer abc123")).toBe("abc123");
    expect(bearerTokenFromAuthHeader("BEARER   abc123")).toBe("abc123");
    expect(bearerTokenFromAuthHeader("  Bearer abc123  ")).toBe("abc123");
  });

  it("menolak selain skema Bearer", () => {
    expect(bearerTokenFromAuthHeader("Basic abc123")).toBeNull();
    expect(bearerTokenFromAuthHeader("abc123")).toBeNull();
    expect(bearerTokenFromAuthHeader("Bearer ")).toBeNull();
    expect(bearerTokenFromAuthHeader("")).toBeNull();
    expect(bearerTokenFromAuthHeader(null)).toBeNull();
    expect(bearerTokenFromAuthHeader(undefined)).toBeNull();
  });
});
