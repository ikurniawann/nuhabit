import { describe, expect, it } from "vitest";
import {
  failOpenOnDbError,
  isMutationMethod,
  rejectionStatus,
  resolveHasSession,
} from "@/lib/auth/session-gate";

describe("isMutationMethod", () => {
  it("POST/PUT/PATCH/DELETE = mutasi; GET/HEAD = bukan", () => {
    for (const m of ["POST", "put", "Patch", "DELETE"]) expect(isMutationMethod(m)).toBe(true);
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isMutationMethod(m)).toBe(false);
  });
});

describe("resolveHasSession — token", () => {
  it("cookie palsu (invalid) tidak pernah dianggap punya sesi", () => {
    expect(resolveHasSession({ validation: "invalid", pathname: "/api/hris/x", method: "DELETE" })).toBe(false);
    expect(resolveHasSession({ validation: "invalid", pathname: "/dashboard", method: "GET" })).toBe(false);
  });
  it("token valid → punya sesi", () => {
    expect(resolveHasSession({ validation: "valid", pathname: "/api/x", method: "POST" })).toBe(true);
  });
});

describe("resolveHasSession — DB error (fail-closed untuk API & mutasi)", () => {
  it("API saat DB error → DITOLAK (fail-closed)", () => {
    expect(resolveHasSession({ validation: "db-error", pathname: "/api/hris/employees", method: "GET" })).toBe(false);
    expect(resolveHasSession({ validation: "db-error", pathname: "/api/pos/orders", method: "POST" })).toBe(false);
  });
  it("mutasi halaman saat DB error → DITOLAK", () => {
    expect(resolveHasSession({ validation: "db-error", pathname: "/dashboard/x", method: "POST" })).toBe(false);
  });
  it("navigasi halaman GET saat DB error → fail-open (tidak menendang user)", () => {
    expect(resolveHasSession({ validation: "db-error", pathname: "/dashboard", method: "GET" })).toBe(true);
    expect(failOpenOnDbError({ pathname: "/dashboard", method: "GET" })).toBe(true);
    expect(failOpenOnDbError({ pathname: "/api/x", method: "GET" })).toBe(false);
  });
});

describe("rejectionStatus", () => {
  it("DB error pada API/mutasi → 503 (transien), selain itu 401", () => {
    expect(rejectionStatus({ validation: "db-error", pathname: "/api/hris", method: "GET" })).toBe(503);
    expect(rejectionStatus({ validation: "db-error", pathname: "/dashboard/x", method: "POST" })).toBe(503);
    expect(rejectionStatus({ validation: "invalid", pathname: "/api/hris", method: "GET" })).toBe(401);
    expect(rejectionStatus({ validation: "db-error", pathname: "/dashboard", method: "GET" })).toBe(401);
  });
});
