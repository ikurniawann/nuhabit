import { describe, expect, it } from "vitest";
import { actionForColumn, completionSummary, groupBySection, groupByStatus, ratePercent } from "./grouping";
import type { TaskItem } from "./types";

const base: TaskItem = {
  occurrence_id: "o",
  task_id: "t",
  title: "x",
  description: "",
  department_id: "d",
  department_name: "Ops",
  assignee_employee_id: "e",
  assignee_name: "E",
  created_by_user_id: "u",
  created_by_name: "E",
  occurrence_date: "2026-10-26",
  status: "pending",
  progress_percent: null,
  started_at: null,
  done_at: null,
  done_by_name: null,
  review_notes: null,
  reviewed_by_name: null,
  recurrence: "once",
  priority: "normal",
  review_required: true,
  timezone: "Asia/Jakarta",
  kpi_indicator_id: null,
  kpi_indicator_code: null,
  kpi_indicator_name: null,
  kpi_contribution: null,
  subtask_count: 0,
  comment_count: 0,
  attachment_count: 0,
  last_note: null,
  last_note_by: null,
  last_note_at: null,
  progress: 0,
  overdue: false,
  mine: true,
  can_work: true,
  can_review: false,
  can_manage: false,
};

const item = (over: Partial<TaskItem>): TaskItem => ({ ...base, ...over, occurrence_id: over.occurrence_id ?? Math.random().toString(36) });

describe("groupBySection", () => {
  it("splits by day and status", () => {
    const g = groupBySection(
      [
        item({ occurrence_date: "2026-10-25", overdue: true }),
        item({ occurrence_date: "2026-10-26" }),
        item({ occurrence_date: "2026-10-27" }),
        item({ status: "done" }),
        item({ status: "approved" }),
        item({ status: "rejected", occurrence_date: "2026-10-20", overdue: true }),
      ],
      "2026-10-26"
    );
    expect([g.overdue.length, g.today.length, g.upcoming.length, g.review.length, g.closed.length]).toEqual([2, 1, 1, 1, 1]);
  });
});

describe("board helpers", () => {
  it("fills every column and counts", () => {
    const items = [item({ status: "in_progress", overdue: true }), item({ status: "approved" }), item({ status: "done" }), item({})];
    const cols = groupByStatus(items);
    expect(Object.keys(cols)).toEqual(["pending", "in_progress", "done", "approved", "rejected"]);
    expect(cols.rejected).toEqual([]);
    expect(completionSummary(items)).toEqual({ open: 2, overdue: 1, review: 1, approved: 1 });
    expect(ratePercent(null)).toBe("—");
    expect(ratePercent(0.666)).toBe("67%");
  });

  it("maps a column drop to the action that gets there", () => {
    const reviewed = item({ status: "pending" });
    expect(actionForColumn("in_progress", reviewed)).toBe("start");
    expect(actionForColumn("done", reviewed)).toBe("done");
    expect(actionForColumn("approved", reviewed)).toBe("approve");
    expect(actionForColumn("rejected", reviewed)).toBe("reject");
    expect(actionForColumn("pending", item({ status: "done" }))).toBe("reopen");
    expect(actionForColumn("pending", reviewed)).toBeNull();
    const personal = item({ review_required: false });
    expect(actionForColumn("approved", personal)).toBe("done");
    expect(actionForColumn("done", personal)).toBeNull();
  });
});
