import { describe, expect, it } from "vitest";
import { evaluateDbQuery, isRpcAllowed, type DbQueryRequest } from "./query-policy";

const HR = ["hris.recruitment", "hris.recruitment.candidates"];

function req(overrides: Partial<DbQueryRequest>): DbQueryRequest {
  return {
    schema: "recruitment",
    table: "candidates",
    action: "select",
    select: "*",
    filters: [],
    orFilters: [],
    userId: "user-1",
    role: "hrd",
    grantedMenuCodes: HR,
    ...overrides,
  };
}

describe("evaluateDbQuery", () => {
  it("mengizinkan select kandidat dengan embed brands/positions untuk grant rekrutmen", () => {
    const decision = evaluateDbQuery(
      req({ select: "*, brands(name), positions(title, brands(name))" })
    );
    expect(decision).toEqual({ allowed: true, forcedFilters: [] });
  });

  it("mengizinkan tulis kandidat dengan filter id", () => {
    const decision = evaluateDbQuery(
      req({ action: "update", filters: [{ col: "id", op: "=", value: "c1" }] })
    );
    expect(decision.allowed).toBe(true);
  });

  it("menolak tabel yang tidak ada di allowlist", () => {
    expect(evaluateDbQuery(req({ schema: "hris", table: "payroll_runs" }))).toMatchObject({
      allowed: false,
      reason: "table not allowlisted",
    });
  });

  it("menolak schema dan tabel yang tidak dikenal", () => {
    expect(evaluateDbQuery(req({ schema: "public", table: "nope" })).allowed).toBe(false);
    expect(evaluateDbQuery(req({ schema: "shadow", table: "candidates" })).allowed).toBe(false);
  });

  it("menolak aksi yang tidak tercantum untuk tabel", () => {
    expect(
      evaluateDbQuery(req({ schema: "item", table: "brands", action: "delete", filters: [{ col: "id", op: "=", value: 1 }] }))
    ).toMatchObject({ allowed: false, reason: "action not allowlisted" });
    expect(evaluateDbQuery(req({ action: "upsert" }))).toMatchObject({ allowed: false });
  });

  it("menolak user tanpa prefix IAM, termasuk role employee", () => {
    const decision = evaluateDbQuery(req({ role: "employee", grantedMenuCodes: ["ess", "ess.leave"] }));
    expect(decision).toMatchObject({ allowed: false, reason: "missing IAM grant" });
  });

  it("menolak embed ke tabel yang tidak di-allowlist untuk induknya", () => {
    expect(evaluateDbQuery(req({ select: "*, users(pos_pin)" }))).toMatchObject({ allowed: false });
    expect(evaluateDbQuery(req({ select: "*, u:users!created_by(*)" }))).toMatchObject({ allowed: false });
    expect(evaluateDbQuery(req({ select: "*, brands(name" }))).toMatchObject({ allowed: false });
  });

  it("menolak auth.* untuk semua aksi, termasuk super_admin", () => {
    for (const action of ["select", "insert", "update", "delete"] as const) {
      const decision = evaluateDbQuery(
        req({
          schema: "auth",
          table: "users",
          action,
          role: "super_admin",
          filters: [{ col: "id", op: "=", value: "x" }],
        })
      );
      expect(decision).toMatchObject({ allowed: false, reason: "schema is never exposed" });
    }
  });

  it("menolak tulis ke iam.* dan configuration.users", () => {
    const filters = [{ col: "id", op: "=", value: "x" }];
    for (const table of ["user_roles", "role_menu_permissions", "menus"]) {
      expect(
        evaluateDbQuery(req({ schema: "iam", table, action: "insert", role: "super_admin", filters }))
      ).toMatchObject({ allowed: false, reason: "writes to this table are never allowed" });
    }
    expect(
      evaluateDbQuery(req({ schema: "configuration", table: "users", action: "update", filters }))
    ).toMatchObject({ allowed: false, reason: "writes to this table are never allowed" });
  });

  it("baca configuration.users hanya baris sendiri dengan filter id yang disuntik", () => {
    const decision = evaluateDbQuery(
      req({
        schema: "configuration",
        table: "users",
        select: "full_name, role",
        filters: [{ col: "id", op: "=", value: "someone-else" }],
        role: "employee",
        grantedMenuCodes: [],
      })
    );
    expect(decision).toEqual({
      allowed: true,
      forcedFilters: [{ col: "id", op: "=", value: "user-1" }],
    });
  });

  it("baca baris sendiri menolak *, embed, dan kolom sensitif", () => {
    const self = { schema: "configuration", table: "users", grantedMenuCodes: [] };
    expect(evaluateDbQuery(req({ ...self, select: "*" })).allowed).toBe(false);
    expect(evaluateDbQuery(req({ ...self, select: "pos_pin" })).allowed).toBe(false);
    expect(evaluateDbQuery(req({ ...self, select: "role, pin:pos_pin" })).allowed).toBe(false);
    expect(evaluateDbQuery(req({ ...self, select: "role, brands(name)" })).allowed).toBe(false);
  });

  it("super_admin hanya melewati cek IAM untuk select pada tabel allowlist", () => {
    const sa = { role: "super_admin", grantedMenuCodes: [] };
    expect(evaluateDbQuery(req(sa)).allowed).toBe(true);
    expect(
      evaluateDbQuery(req({ ...sa, action: "delete", filters: [{ col: "id", op: "=", value: "c1" }] }))
    ).toMatchObject({ allowed: false, reason: "missing IAM grant" });
    expect(evaluateDbQuery(req({ ...sa, schema: "iam", table: "user_roles" })).allowed).toBe(false);
  });

  it("menolak operator filter di luar daftar (operator masuk SQL mentah)", () => {
    const decision = evaluateDbQuery(
      req({ filters: [{ col: "id", op: "= $1 OR true OR id =", value: "x" }] })
    );
    expect(decision).toMatchObject({ allowed: false, reason: "invalid filter" });
    expect(
      evaluateDbQuery(req({ filters: [{ col: "deleted_at", op: "NOT IS", value: null }] })).allowed
    ).toBe(true);
  });

  it("menolak update/delete tanpa filter", () => {
    expect(evaluateDbQuery(req({ action: "delete" }))).toMatchObject({
      allowed: false,
      reason: "update/delete requires a filter",
    });
  });

  it("menolak identifier tidak aman", () => {
    expect(evaluateDbQuery(req({ table: 'candidates"; drop' })).allowed).toBe(false);
    expect(evaluateDbQuery(req({ schema: "auth.users" })).allowed).toBe(false);
  });
});

describe("isRpcAllowed", () => {
  it("menolak semua fungsi selama allowlist kosong", () => {
    expect(isRpcAllowed("add_xp_to_user")).toBe(false);
    expect(isRpcAllowed("pg_read_file")).toBe(false);
    expect(isRpcAllowed(undefined)).toBe(false);
  });
});
