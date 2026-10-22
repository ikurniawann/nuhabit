import { query } from "@/lib/db";
import { ensureOccurrences } from "@/lib/hris/dept-tasks";
import {
  effectiveProgress,
  groupByDepartment,
  type MonitorOccurrence,
  type OccurrenceStatus,
  overdueList,
  summarize,
} from "@/lib/hris/dept-task-monitor";

/**
 * Data pemantauan Task Departemen (EPIC-068) untuk departemen yang boleh
 * dilihat aktor pada rentang [start..end]. Kemunculan di-generate dulu
 * (idempoten, sama dengan daftar task) supaya task rutin ikut terhitung.
 */
export async function loadDeptTaskMonitor(departmentIds: string[], start: string, end: string, today: string) {
  for (const id of departmentIds) await ensureOccurrences(id, start, end);
  const rows = departmentIds.length
    ? await query<{
        occurrence_id: string;
        task_id: string;
        title: string;
        department_id: string;
        department_name: string;
        assignee_id: string | null;
        assignee_name: string | null;
        occurrence_date: string;
        status: OccurrenceStatus;
        progress_percent: number | null;
        subtask_total: string | null;
        subtask_done: string | null;
        last_note: string | null;
        last_note_at: string | null;
      }>(
        `SELECT o.id AS occurrence_id, t.id AS task_id, t.title, t.department_id, d.name AS department_name,
                t.assignee_employee_id AS assignee_id, a.full_name AS assignee_name,
                o.occurrence_date::text AS occurrence_date, o.status, o.progress_percent,
                st.total AS subtask_total, st.done AS subtask_done,
                u.note AS last_note, u.created_at AS last_note_at
         FROM hris.department_task_occurrences o
         JOIN hris.department_tasks t ON t.id = o.task_id
         JOIN hris.departments d ON d.id = t.department_id
         LEFT JOIN hris.employees a ON a.id = t.assignee_employee_id
         LEFT JOIN LATERAL (
           SELECT SUM(s.weight) AS total, SUM(s.weight) FILTER (WHERE oi.is_checked) AS done
           FROM hris.department_task_subtasks s
           LEFT JOIN hris.department_task_occurrence_items oi ON oi.subtask_id = s.id AND oi.occurrence_id = o.id
           WHERE s.task_id = t.id
         ) st ON true
         LEFT JOIN LATERAL (
           SELECT note, created_at FROM hris.department_task_updates
           WHERE occurrence_id = o.id AND note IS NOT NULL ORDER BY created_at DESC LIMIT 1
         ) u ON true
         WHERE t.department_id = ANY($1::uuid[]) AND t.is_active
           AND o.occurrence_date BETWEEN $2::date AND $3::date`,
        [departmentIds, start, end]
      )
    : [];
  const list: MonitorOccurrence[] = rows.map((r) => {
    const total = Number(r.subtask_total ?? 0);
    const subtaskPercent = total > 0 ? (Number(r.subtask_done ?? 0) / total) * 100 : null;
    return {
      occurrence_id: r.occurrence_id,
      task_id: r.task_id,
      title: r.title,
      department_id: r.department_id,
      department_name: r.department_name,
      assignee_id: r.assignee_id,
      assignee_name: r.assignee_name,
      occurrence_date: r.occurrence_date,
      status: r.status,
      progress: effectiveProgress({ status: r.status, manualPercent: r.progress_percent, subtaskPercent }),
      last_note: r.last_note,
      last_note_at: r.last_note_at,
    };
  });
  return {
    start,
    end,
    today,
    summary: summarize(list, today),
    departments: groupByDepartment(list, today),
    overdue: overdueList(list, today),
    waiting_review: list
      .filter((o) => o.status === "done")
      .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))
      .slice(0, 50),
  };
}
