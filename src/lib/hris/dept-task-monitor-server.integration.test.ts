/**
 * Test integrasi pemantauan Task Departemen (EPIC-068). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { loadDeptTaskMonitor } from "./dept-task-monitor-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const tag = randomUUID().slice(0, 8);
let deptId = "";
let otherDept = "";
const emp: Record<string, string> = {};
const today = "2026-09-10";

describe.skipIf(!IS_TEST_DB)("pemantauan Task Departemen (DB)", () => {
  beforeAll(async () => {
    deptId = (await query<{ id: string }>(`INSERT INTO hris.departments (name, code) VALUES ($1, $2) RETURNING id`, [`Coach ${tag}`, `C${tag}`]))[0].id;
    otherDept = (await query<{ id: string }>(`INSERT INTO hris.departments (name, code) VALUES ($1, $2) RETURNING id`, [`FD ${tag}`, `F${tag}`]))[0].id;
    for (const k of ["pras", "rara"]) {
      emp[k] = (await query<{ id: string }>(
        `INSERT INTO hris.employees (full_name, nip, email, phone, join_date, department_id) VALUES ($1, $2, $3, '-', '2026-01-01', $4) RETURNING id`,
        [`${k} ${tag}`, `DT-${k}-${tag}`, `${k}-${tag}@dt.test`, deptId]
      ))[0].id;
    }
    const task = async (title: string, recurrence: string, assignee: string | null, extra: Record<string, unknown> = {}, dept = deptId) =>
      (await query<{ id: string }>(
        `INSERT INTO hris.department_tasks (department_id, assignee_employee_id, title, recurrence, weekly_day, due_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [dept, assignee, title, recurrence, extra.weekly_day ?? null, extra.due_date ?? null]
      ))[0].id;
    // Sekali jalan, terlambat, sedang dikerjakan 40% + catatan.
    const t1 = await task(`Inventaris alat ${tag}`, "once", emp.pras, { due_date: "2026-09-05" });
    // Sekali jalan dengan 2 sub-task, 1 dicentang (50%).
    const t2 = await task(`Audit kebersihan ${tag}`, "once", emp.rara, { due_date: "2026-09-08" });
    // Sekali jalan, sudah selesai menunggu review.
    const t3 = await task(`Laporan bulanan ${tag}`, "once", null, { due_date: "2026-09-09" });
    // Mendatang.
    await task(`Event Oktober ${tag}`, "once", emp.pras, { due_date: "2026-09-25" });
    // Departemen lain — tidak boleh ikut bila tidak diminta.
    await task(`Task FD ${tag}`, "once", null, { due_date: "2026-09-05" }, otherDept);

    const ensure = async (taskId: string, date: string, status: string, progress: number | null = null) =>
      (await query<{ id: string }>(
        `INSERT INTO hris.department_task_occurrences (task_id, occurrence_date, status, progress_percent)
         VALUES ($1, $2, $3, $4) ON CONFLICT (task_id, occurrence_date) DO UPDATE SET status = EXCLUDED.status, progress_percent = EXCLUDED.progress_percent
         RETURNING id`,
        [taskId, date, status, progress]
      ))[0].id;
    const o1 = await ensure(t1, "2026-09-05", "in_progress", 40);
    await query(`INSERT INTO hris.department_task_updates (occurrence_id, note, progress_percent, author_name) VALUES ($1, 'Rak A selesai', 20, 'pras'), ($1, 'Rak B selesai', 40, 'pras')`, [o1]);
    const o2 = await ensure(t2, "2026-09-08", "in_progress");
    const subs = await query<{ id: string }>(
      `INSERT INTO hris.department_task_subtasks (task_id, title, weight, sort_order) VALUES ($1, 'Lantai', 50, 0), ($1, 'Toilet', 50, 1) RETURNING id`,
      [t2]
    );
    await query(`INSERT INTO hris.department_task_occurrence_items (occurrence_id, subtask_id, is_checked) VALUES ($1, $2, true)`, [o2, subs[0].id]);
    await ensure(t3, "2026-09-09", "done");
  });

  afterAll(async () => {
    await query(`DELETE FROM hris.department_tasks WHERE department_id = ANY($1::uuid[])`, [[deptId, otherDept]]);
    await query(`DELETE FROM hris.employees WHERE id = ANY($1::uuid[])`, [Object.values(emp)]);
    await query(`DELETE FROM hris.departments WHERE id = ANY($1::uuid[])`, [[deptId, otherDept]]);
  });

  it("ringkasan departemen: progres manual & sub-task, terlambat, tunggu review, mendatang tidak jatuh tempo", async () => {
    const d = await loadDeptTaskMonitor([deptId], "2026-09-01", "2026-09-30", today);
    expect(d.summary).toMatchObject({ scheduled: 4, due: 3, approved: 0, waiting_review: 1, in_progress: 2, overdue: 2, completion: 0 });
    // (40 + 50 + 100) / 3
    expect(d.summary.avg_progress).toBe(63);
    expect(d.departments).toHaveLength(1);
    expect(d.departments[0].assignees.map((a) => [a.assignee_name.split(" ")[0], a.due, a.overdue])).toEqual([
      ["pras", 1, 1],
      ["rara", 1, 1],
      ["Departemen", 1, 0],
    ]);
  });

  it("daftar terlambat berisi catatan terakhir & progres; menunggu review terdaftar", async () => {
    const d = await loadDeptTaskMonitor([deptId], "2026-09-01", "2026-09-30", today);
    expect(d.overdue.map((o) => [o.title.split(" ")[0], o.progress, o.last_note])).toEqual([
      ["Inventaris", 40, "Rak B selesai"],
      ["Audit", 50, null],
    ]);
    expect(d.waiting_review.map((o) => o.title.split(" ")[0])).toEqual(["Laporan"]);
  });

  it("hanya departemen yang diminta; daftar kosong aman", async () => {
    const both = await loadDeptTaskMonitor([deptId, otherDept], "2026-09-01", "2026-09-30", today);
    expect(both.departments.map((x) => x.department_name.split(" ")[0]).sort()).toEqual(["Coach", "FD"]);
    const none = await loadDeptTaskMonitor([], "2026-09-01", "2026-09-30", today);
    expect(none.departments).toEqual([]);
    expect(none.summary.due).toBe(0);
  });
});
