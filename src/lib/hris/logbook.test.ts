import { describe, expect, it } from "vitest";
import {
  canDeleteEntry,
  canEditEntryItems,
  canReviewEntry,
  canReviewLogbook,
  canSubmitEntry,
  hasFullLogbookAccess,
  LOGBOOK_NOTE_MAX_LENGTH,
  normalizeLogbookNote,
  resolveDepartmentScope,
  summarizeLogbookEntries,
  templateItemWeight,
} from "@/lib/hris/logbook";

describe("logbook role guards", () => {
  it("grants full access to super_admin, admin, hrd only", () => {
    expect(hasFullLogbookAccess("super_admin")).toBe(true);
    expect(hasFullLogbookAccess("admin")).toBe(true);
    expect(hasFullLogbookAccess("hrd")).toBe(true);
    expect(hasFullLogbookAccess("purchasing_manager")).toBe(false);
    expect(hasFullLogbookAccess("")).toBe(false);
  });

  it("allows review only for super_admin and hrd", () => {
    expect(canReviewLogbook("super_admin")).toBe(true);
    expect(canReviewLogbook("hrd")).toBe(true);
    expect(canReviewLogbook("admin")).toBe(false);
    expect(canReviewLogbook("employee")).toBe(false);
  });
});

describe("logbook status flow guards", () => {
  it("submit only from draft", () => {
    expect(canSubmitEntry("draft")).toBe(true);
    expect(canSubmitEntry("submitted")).toBe(false);
    expect(canSubmitEntry("reviewed")).toBe(false);
    expect(canSubmitEntry("rejected")).toBe(false);
  });

  it("review only from submitted", () => {
    expect(canReviewEntry("submitted")).toBe(true);
    expect(canReviewEntry("draft")).toBe(false);
    expect(canReviewEntry("reviewed")).toBe(false);
  });

  it("delete and item edits only while draft", () => {
    expect(canDeleteEntry("draft")).toBe(true);
    expect(canDeleteEntry("submitted")).toBe(false);
    expect(canEditEntryItems("draft")).toBe(true);
    expect(canEditEntryItems("submitted")).toBe(false);
  });
});

describe("resolveDepartmentScope", () => {
  const dept = "dept-1";
  const other = "dept-2";

  it("full access: free to pick any department or all", () => {
    const actor = { isFullAccess: true, departmentId: null };
    expect(resolveDepartmentScope(actor, null)).toEqual({
      allowed: true,
      departmentId: null,
    });
    expect(resolveDepartmentScope(actor, other)).toEqual({
      allowed: true,
      departmentId: other,
    });
  });

  it("non full access: locked to own department even without explicit request", () => {
    const actor = { isFullAccess: false, departmentId: dept };
    expect(resolveDepartmentScope(actor, null)).toEqual({
      allowed: true,
      departmentId: dept,
    });
    expect(resolveDepartmentScope(actor, dept)).toEqual({
      allowed: true,
      departmentId: dept,
    });
  });

  it("non full access: requesting another department is denied", () => {
    const actor = { isFullAccess: false, departmentId: dept };
    expect(resolveDepartmentScope(actor, other).allowed).toBe(false);
  });

  it("non full access without linked department is denied", () => {
    const actor = { isFullAccess: false, departmentId: null };
    expect(resolveDepartmentScope(actor, null).allowed).toBe(false);
    expect(resolveDepartmentScope(actor, dept).allowed).toBe(false);
  });
});

describe("normalizeLogbookNote", () => {
  it("kosong → null, teks dipertahankan", () => {
    expect(normalizeLogbookNote(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeLogbookNote("")).toEqual({ ok: true, value: null });
    expect(normalizeLogbookNote("<p>ok</p>")).toEqual({ ok: true, value: "<p>ok</p>" });
  });
  it("bukan string atau terlalu panjang ditolak", () => {
    expect(normalizeLogbookNote(5)).toEqual({ ok: false });
    expect(normalizeLogbookNote("x".repeat(LOGBOOK_NOTE_MAX_LENGTH + 1))).toEqual({ ok: false });
  });
});

describe("templateItemWeight", () => {
  it("bobot 0 eksplisit dipertahankan, kosong default 1, negatif jadi 0", () => {
    expect(templateItemWeight(0)).toBe(0);
    expect(templateItemWeight(undefined)).toBe(1);
    expect(templateItemWeight(null)).toBe(1);
    expect(templateItemWeight("abc")).toBe(1);
    expect(templateItemWeight("2.5")).toBe(2.5);
    expect(templateItemWeight(-3)).toBe(0);
  });
});

describe("summarizeLogbookEntries", () => {
  it("mengelompokkan per department dan merata-rata 2 desimal", () => {
    const dept = { id: "d1", name: "Bar" };
    const rows = summarizeLogbookEntries([
      { department_id: "d1", department: dept, status: "submitted", completion_percentage: "50", kpi_score: 80 },
      { department_id: "d1", department: dept, status: "reviewed", completion_percentage: 100, kpi_score: null },
      { department_id: "d1", department: dept, status: "draft", completion_percentage: 0, kpi_score: 70 },
      { department_id: "d2", department: null, status: "draft", completion_percentage: null, kpi_score: null },
    ]);
    expect(rows).toEqual([
      {
        department: dept,
        total_entries: 3,
        submitted_entries: 1,
        reviewed_entries: 1,
        avg_completion: 50,
        avg_kpi_score: 50,
      },
      {
        department: null,
        total_entries: 1,
        submitted_entries: 0,
        reviewed_entries: 0,
        avg_completion: 0,
        avg_kpi_score: 0,
      },
    ]);
  });
});
