import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateAccess, isDataroomAdminRole } from "./access";

describe("dataroom evaluateAccess", () => {
  it("folder tanpa konfigurasi terbuka untuk siapa pun", () => {
    expect(evaluateAccess([], "hrd", false)).toBe(true);
    expect(evaluateAccess([[], null, undefined], null, false)).toBe(true);
  });

  it("konfigurasi di jalur harus memuat departemen user", () => {
    expect(evaluateAccess([["hrd", "fin"]], "hrd", false)).toBe(true);
    expect(evaluateAccess([["hrd", "fin"]], "ops", false)).toBe(false);
    expect(evaluateAccess([["hrd"], ["hrd", "fin"]], "hrd", false)).toBe(true);
    // subfolder dibuka untuk fin, tapi induknya hanya hrd → tetap ditolak
    expect(evaluateAccess([["fin"], ["hrd"]], "fin", false)).toBe(false);
  });

  it("user tanpa departemen hanya bisa folder terbuka; super admin selalu bisa", () => {
    expect(evaluateAccess([["hrd"]], null, false)).toBe(false);
    expect(evaluateAccess([["hrd"]], null, true)).toBe(true);
    expect(isDataroomAdminRole("super_admin")).toBe(true);
    expect(isDataroomAdminRole("admin")).toBe(false);
  });
});

// ── Instance yang belum dimigrasi (dataroom.folder_departments belum ada) ──
// Regresi production 2026-09-07: modul Dataroom mati total (500) di server
// yang belum menjalankan 20260905110000. Sekarang harus jatuh ke perilaku
// sebelum fitur ada: tanpa pembatasan departemen.
describe("instance tanpa tabel folder_departments", () => {
  const missing = Object.assign(new Error('relation "dataroom.folder_departments" does not exist'), {
    code: "42P01",
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("createAccessResolver tetap jalan dan tidak membatasi apa pun", async () => {
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async (sql: string) =>
        sql.includes("folder_departments") ? Promise.reject(missing) : []
      ),
      queryOne: vi.fn(async () => null),
    }));
    const mod = await import("./access");
    const resolver = await mod.createAccessResolver({
      userId: "u1", isAdmin: false, departmentId: null, departmentName: null,
    });
    expect(resolver.allowsFolder("f1")).toBe(true);
    expect(resolver.configured("f1")).toEqual([]);
  });

  it("getDepartmentsForNodes mengembalikan peta kosong", async () => {
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => Promise.reject(missing)),
      queryOne: vi.fn(async () => null),
    }));
    const mod = await import("./access");
    await expect(mod.getDepartmentsForNodes(["n1"])).resolves.toEqual(new Map());
  });

  it("setNodeDepartments memberi pesan agar migration dijalankan", async () => {
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => Promise.reject(missing)),
      queryOne: vi.fn(async () => null),
    }));
    const mod = await import("./access");
    await expect(mod.setNodeDepartments("n1", ["d1"], "u1")).rejects.toThrow(
      /20260905110000_dataroom_folder_departments\.sql/
    );
  });

  it("error lain tetap dilempar", async () => {
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => Promise.reject(Object.assign(new Error("boom"), { code: "42501" }))),
      queryOne: vi.fn(async () => null),
    }));
    const mod = await import("./access");
    await expect(mod.getDepartmentsForNodes(["n1"])).rejects.toThrow("boom");
  });
});
