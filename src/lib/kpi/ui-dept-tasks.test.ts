import { describe, it, expect } from "vitest";
import {
  groupByTask,
  hasOpenToday,
  indexChecked,
  isOverdue,
  subtaskProgress,
  summarizeOccurrences,
} from "./ui-dept-tasks";

const occ = (id: string, date: string, status: "pending" | "done" | "approved" | "rejected", task_id = "t1") => ({
  id,
  task_id,
  occurrence_date: date,
  status,
});

describe("groupByTask", () => {
  it("groups rows by task id in order", () => {
    const rows = [occ("a", "2026-10-01", "pending"), occ("b", "2026-10-01", "done", "t2"), occ("c", "2026-10-02", "done")];
    const map = groupByTask(rows);
    expect(map.get("t1")?.map((r) => r.id)).toEqual(["a", "c"]);
    expect(map.get("t2")?.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("summaries", () => {
  const rows = [
    occ("a", "2026-10-03", "pending"),
    occ("b", "2026-10-04", "done"),
    occ("c", "2026-10-04", "approved"),
  ];

  it("counts waiting and approved", () => {
    expect(summarizeOccurrences(rows)).toEqual({ total: 3, waiting: 1, approved: 1 });
  });

  it("detects open work today and overdue items", () => {
    expect(hasOpenToday(rows, "2026-10-04")).toBe(true);
    expect(hasOpenToday([rows[2]], "2026-10-04")).toBe(false);
    expect(isOverdue(rows[0], "2026-10-04")).toBe(true);
    expect(isOverdue(rows[1], "2026-10-05")).toBe(false);
  });
});

describe("sub-task progress", () => {
  it("sums the weight of checked sub-tasks only", () => {
    const checked = indexChecked([
      { occurrence_id: "o1", subtask_id: "s1", is_checked: true, checked_by_name: "Ani", checked_at: "2026-10-04T03:00:00Z" },
      { occurrence_id: "o1", subtask_id: "s2", is_checked: false },
    ]);
    const subs = [
      { id: "s1", task_id: "t1", weight: "33.33" },
      { id: "s2", task_id: "t1", weight: 66.67 },
    ];
    expect(checked.get("o1:s1")).toEqual({ name: "Ani", at: "2026-10-04T03:00:00Z" });
    expect(checked.has("o1:s2")).toBe(false);
    expect(subtaskProgress("o1", subs, checked)).toBeCloseTo(33.33);
    expect(subtaskProgress("o2", subs, checked)).toBe(0);
  });
});
