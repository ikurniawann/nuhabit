import { describe, expect, it } from "vitest";
import { daysLate, effectiveProgress, groupByDepartment, isOverdue, type MonitorOccurrence, overdueList, summarize } from "./dept-task-monitor";

const today = "2026-10-22";
let seq = 0;
const occ = (o: Partial<MonitorOccurrence>): MonitorOccurrence => ({
  occurrence_id: `o${++seq}`,
  task_id: "t1",
  title: "Cek alat",
  department_id: "d1",
  department_name: "Coach",
  assignee_id: "a1",
  assignee_name: "Pras",
  occurrence_date: today,
  status: "pending",
  progress: 0,
  last_note: null,
  last_note_at: null,
  ...o,
});

describe("progres efektif", () => {
  it("selesai/disetujui 100; belum 0; dikerjakan dari sub-task atau manual, maks 99; ditolak maks 99", () => {
    expect(effectiveProgress({ status: "approved", manualPercent: null, subtaskPercent: null })).toBe(100);
    expect(effectiveProgress({ status: "done", manualPercent: 10, subtaskPercent: null })).toBe(100);
    expect(effectiveProgress({ status: "pending", manualPercent: 50, subtaskPercent: 50 })).toBe(0);
    expect(effectiveProgress({ status: "in_progress", manualPercent: 40, subtaskPercent: null })).toBe(40);
    expect(effectiveProgress({ status: "in_progress", manualPercent: 40, subtaskPercent: 66.7 })).toBe(67);
    expect(effectiveProgress({ status: "rejected", manualPercent: null, subtaskPercent: 100 })).toBe(99);
    expect(effectiveProgress({ status: "in_progress", manualPercent: null, subtaskPercent: null })).toBe(0);
  });
});

describe("terlambat", () => {
  it("lewat tanggal & belum selesai (belum, dikerjakan, ditolak); hari ini belum terlambat", () => {
    expect(isOverdue({ occurrence_date: "2026-10-21", status: "pending" }, today)).toBe(true);
    expect(isOverdue({ occurrence_date: "2026-10-21", status: "in_progress" }, today)).toBe(true);
    expect(isOverdue({ occurrence_date: "2026-10-21", status: "rejected" }, today)).toBe(true);
    expect(isOverdue({ occurrence_date: "2026-10-21", status: "done" }, today)).toBe(false);
    expect(isOverdue({ occurrence_date: today, status: "pending" }, today)).toBe(false);
    expect(daysLate("2026-10-19", today)).toBe(3);
  });
});

describe("ringkasan & pengelompokan", () => {
  const list = [
    occ({ occurrence_date: "2026-10-20", status: "approved", progress: 100 }),
    occ({ occurrence_date: "2026-10-21", status: "in_progress", progress: 50 }),
    occ({ occurrence_date: today, status: "done", progress: 100 }),
    occ({ occurrence_date: "2026-10-25", status: "pending" }), // mendatang — tidak dihitung jatuh tempo
    occ({ department_id: "d2", department_name: "Front desk", assignee_id: null, assignee_name: null, occurrence_date: "2026-10-18", status: "pending" }),
    occ({ department_id: "d2", department_name: "Front desk", assignee_id: "a2", assignee_name: "Rara", occurrence_date: "2026-10-19", status: "approved", progress: 100 }),
  ];

  it("jatuh tempo hanya s/d hari ini; penyelesaian = disetujui ÷ jatuh tempo; progres rata-rata", () => {
    const s = summarize(list.filter((o) => o.department_id === "d1"), today);
    expect(s).toEqual({
      scheduled: 4, due: 3, approved: 1, waiting_review: 1, in_progress: 1, not_started: 0, rejected: 0,
      overdue: 1, completion: 1 / 3, avg_progress: 83,
    });
    expect(summarize([], today)).toMatchObject({ due: 0, completion: null, avg_progress: null });
  });

  it("per departemen (terlambat terbanyak dulu) dan per PJ, termasuk task tanpa PJ", () => {
    const g = groupByDepartment(list, today);
    expect(g.map((d) => [d.department_name, d.overdue, d.due])).toEqual([
      ["Coach", 1, 3],
      ["Front desk", 1, 2],
    ]);
    expect(g[1].assignees.map((a) => [a.assignee_name, a.due, a.overdue])).toEqual([
      ["Departemen (tanpa PJ)", 1, 1],
      ["Rara", 1, 0],
    ]);
  });

  it("daftar terlambat: paling lama dulu", () => {
    expect(overdueList(list, today).map((o) => o.occurrence_date)).toEqual(["2026-10-18", "2026-10-21"]);
  });
});
