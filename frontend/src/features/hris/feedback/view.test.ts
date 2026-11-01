import { describe, expect, it } from "vitest";
import { CATEGORIES, cycle } from "./feedback.test-util";
import type { FeedbackSummary } from "./types";
import {
  answerProgress,
  answersFrom,
  assignmentStats,
  buildAssignments,
  cycleProgress,
  cycleToForm,
  emptyAssignForm,
  sortSummaries,
  toCyclePayload,
  toSavePayload,
  validateCycleForm,
} from "./view";

describe("cycle form", () => {
  it("defaults a new cycle to a 70/30 draft and round-trips an existing one", () => {
    const blank = cycleToForm(null);
    expect(blank).toMatchObject({ status: "draft", kpi_weight: "70", feedback_weight: "30", is_anonymous: true });
    expect(validateCycleForm(blank)).toBe("Nama siklus wajib diisi");

    const form = cycleToForm(cycle({ kpi_weight: "60.00", feedback_weight: "40.00" }));
    expect(form.start_date).toBe("2026-10-01");
    expect(validateCycleForm(form)).toBeNull();
    expect(toCyclePayload({ ...form, name: "  Review  " })).toMatchObject({ name: "Review", kpi_weight: 60, feedback_weight: 40 });
  });

  it("rejects weights that do not add up to 100 and an end before the start", () => {
    const form = cycleToForm(cycle());
    expect(validateCycleForm({ ...form, feedback_weight: "40" })).toBe("Bobot KPI dan Feedback 360° harus berjumlah 100");
    expect(validateCycleForm({ ...form, kpi_weight: "-10", feedback_weight: "110" })).toBe("Bobot harus 0 sampai 100");
    expect(validateCycleForm({ ...form, end_date: "2026-09-30" })).toBe("Tanggal selesai harus setelah tanggal mulai");
  });

  it("reports progress from the completed and total assignments", () => {
    expect(cycleProgress(cycle())).toEqual({ done: 1, total: 4, percent: 25 });
    expect(cycleProgress(cycle({ assignments_count: [], completed_count: 0 }))).toEqual({ done: 0, total: 0, percent: 0 });
    expect(assignmentStats([{ status: "pending" }, { status: "submitted" }, { status: "submitted" }])).toMatchObject({
      pending: 1,
      submitted: 2,
      approved: 0,
    });
  });
});

describe("buildAssignments", () => {
  const form = { ...emptyAssignForm(), employee_id: "e-1", due_date: "2026-11-15" };

  it("adds the self-assessment and each reviewer once", () => {
    const rows = buildAssignments(
      "c-1",
      {
        ...form,
        reviewers: [
          { relationship: "manager", reviewer_id: "e-boss" },
          { relationship: "peer", reviewer_id: "e-2" },
          { relationship: "peer", reviewer_id: "e-2" },
          { relationship: "peer", reviewer_id: "" },
        ],
      },
      true
    );
    expect(rows.map((r) => `${r.relationship_type}:${r.reviewer_id}`)).toEqual(["self:e-1", "manager:e-boss", "peer:e-2"]);
    expect(rows[0]).toMatchObject({ cycle_id: "c-1", employee_id: "e-1", due_date: "2026-11-15" });
  });

  it("skips self when the cycle forbids it and refuses invalid forms", () => {
    const manager = [{ relationship: "manager" as const, reviewer_id: "e-boss" }];
    expect(buildAssignments("c-1", { ...form, reviewers: manager }, false)).toHaveLength(1);
    expect(() => buildAssignments("c-1", { ...form, employee_id: "" }, true)).toThrow("Pilih karyawan yang dinilai");
    expect(() => buildAssignments("c-1", { ...form, include_self: false, reviewers: [] }, true)).toThrow(
      "Tambahkan minimal satu penilai"
    );
    expect(() =>
      buildAssignments("c-1", { ...form, reviewers: [{ relationship: "peer", reviewer_id: "e-1" }] }, true)
    ).toThrow("Penilai tidak boleh sama dengan karyawan yang dinilai");
  });
});

describe("sortSummaries", () => {
  const row = (id: string, final: string | null, overall: string | null) =>
    ({ id, final_score: final, overall_360_score: overall }) as FeedbackSummary;

  it("ranks final scores first, then rows with only a 360 score", () => {
    const sorted = sortSummaries([row("a", null, "90.00"), row("b", "80.00", "70.00"), row("c", "88.00", "60.00"), row("d", null, null)]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("reviewer answers", () => {
  it("counts rated criteria and sends only rated ones, blank notes as null", () => {
    const answers = { ...answersFrom([{ criteria_id: "cr-1", rating: 4, comments: "Jelas" }]), "cr-2": { rating: null, comments: "x" } };
    expect(answerProgress(answers, CATEGORIES)).toEqual({ answered: 1, total: 3, complete: false });

    const full = { ...answers, "cr-2": { rating: 5, comments: "  " }, "cr-3": { rating: 3, comments: "" } };
    expect(answerProgress(full, CATEGORIES).complete).toBe(true);
    expect(toSavePayload(full, true)).toEqual({
      submit: true,
      responses: [
        { criteria_id: "cr-1", rating: 4, comments: "Jelas" },
        { criteria_id: "cr-2", rating: 5, comments: null },
        { criteria_id: "cr-3", rating: 3, comments: null },
      ],
    });
  });
});
