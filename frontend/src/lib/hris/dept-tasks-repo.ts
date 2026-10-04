import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { ensureOccurrences, monthRange, normalizeDeptTask } from "./dept-tasks";
import type { WorkforceActor } from "./workforce-auth";
import { isUuid, requireLinkedEmployee } from "./workforce-route";

/**
 * Task Departemen (owner 2026-08-30, konsep MBO/task compliance): papan
 * bulanan, pembuatan task, nonaktifkan, dan aksi per kemunculan. HR bebas
 * lintas departemen; non-HR dibatasi departemennya, dan membuat/mereview
 * hanya bila ia atasan (punya bawahan langsung aktif).
 */

export interface TaskActor extends WorkforceActor {
  departmentId: string | null;
  fullName: string | null;
  hasSubordinates: boolean;
}

export async function loadTaskActor(actor: WorkforceActor): Promise<TaskActor> {
  if (!actor.employeeId) {
    return { ...actor, departmentId: null, fullName: null, hasSubordinates: false };
  }
  const me = await queryOne<{ department_id: string | null; full_name: string; subordinates: number }>(
    `SELECT e.department_id, e.full_name,
            (SELECT count(*) FROM hris.employees s
             WHERE s.reporting_to = e.id AND s.is_active)::int AS subordinates
     FROM hris.employees e WHERE e.id = $1`,
    [actor.employeeId]
  );
  return {
    ...actor,
    departmentId: me?.department_id ?? null,
    fullName: me?.full_name ?? null,
    hasSubordinates: (me?.subordinates ?? 0) > 0,
  };
}

/** Departemen sasaran: HR boleh memilih lewat parameter; lainnya departemen sendiri. */
function targetDepartment(me: TaskActor, requested: string | null | undefined): string | null {
  return me.isHr && isUuid(requested) ? requested : me.departmentId;
}

export async function loadDeptTaskBoard(me: TaskActor, month: string, requestedDept: string | null) {
  const departmentId = targetDepartment(me, requestedDept);
  const departments = me.isHr ? await query(`SELECT id, name FROM hris.departments ORDER BY name`) : [];
  if (!departmentId) {
    return {
      department_id: null,
      tasks: [],
      occurrences: [],
      members: [],
      departments,
      can_manage: me.isHr,
      is_hr: me.isHr,
    };
  }

  const { start, end } = monthRange(month);
  await ensureOccurrences(departmentId, start, end);

  const [tasks, occurrences, members, subtasks, checkedItems] = await Promise.all([
    query(
      `SELECT t.id, t.title, t.description, t.recurrence, t.weekly_day,
              t.monthly_day, t.due_date::text, t.is_active,
              t.assignee_employee_id, a.full_name AS assignee_name,
              t.created_by_name
       FROM hris.department_tasks t
       LEFT JOIN hris.employees a ON a.id = t.assignee_employee_id
       WHERE t.department_id = $1 AND t.is_active = true
       ORDER BY t.created_at`,
      [departmentId]
    ),
    query(
      `SELECT o.id, o.task_id, o.occurrence_date::text, o.status,
              o.done_at, o.done_by_name, o.review_notes, o.reviewed_by_name
       FROM hris.department_task_occurrences o
       JOIN hris.department_tasks t ON t.id = o.task_id
       WHERE t.department_id = $1
         AND o.occurrence_date BETWEEN $2 AND $3
       ORDER BY o.occurrence_date, t.created_at`,
      [departmentId, start, end]
    ),
    query(
      `SELECT id, full_name FROM hris.employees
       WHERE department_id = $1 AND is_active ORDER BY full_name`,
      [departmentId]
    ),
    query(
      `SELECT st.id, st.task_id, st.title, st.weight, st.sort_order
       FROM hris.department_task_subtasks st
       JOIN hris.department_tasks t ON t.id = st.task_id
       WHERE t.department_id = $1
       ORDER BY st.task_id, st.sort_order, st.created_at`,
      [departmentId]
    ),
    query(
      `SELECT oi.occurrence_id, oi.subtask_id, oi.is_checked,
              oi.checked_by_name, oi.checked_at
       FROM hris.department_task_occurrence_items oi
       JOIN hris.department_task_occurrences o ON o.id = oi.occurrence_id
       JOIN hris.department_tasks t ON t.id = o.task_id
       WHERE t.department_id = $1
         AND o.occurrence_date BETWEEN $2 AND $3`,
      [departmentId, start, end]
    ),
  ]);

  return {
    department_id: departmentId,
    tasks,
    occurrences,
    members,
    subtasks,
    checked_items: checkedItems,
    departments,
    can_manage: me.isHr || me.hasSubordinates,
    // Review = Head Division departemen ini (atau HRD sbg cadangan).
    can_review: me.isHr || (me.hasSubordinates && departmentId === me.departmentId),
    is_hr: me.isHr,
    my_employee_id: me.employeeId,
  };
}

const dayField = z.union([z.number(), z.string()]).nullable().optional();

export const deptTaskCreateSchema = z.object({
  department_id: z.string().nullable().optional(),
  assignee_employee_id: z.string().nullable().optional(),
  title: z.string().max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  recurrence: z.string().max(20).optional(),
  weekly_day: dayField,
  monthly_day: dayField,
  due_date: z.string().max(10).nullable().optional(),
  subtasks: z.array(z.object({ title: z.string().max(255).optional() })).optional(),
});

export async function createDeptTask(me: TaskActor, body: z.infer<typeof deptTaskCreateSchema>) {
  const task = normalizeDeptTask(body);
  if (typeof task === "string") throw ApiError.badRequest(task);

  const departmentId = targetDepartment(me, body.department_id);
  if (!departmentId) throw ApiError.badRequest("Departemen tidak diketahui");
  if (!me.isHr) {
    if (!me.hasSubordinates) {
      throw ApiError.forbidden("Hanya HRD atau atasan (kepala tim) yang boleh membuat task departemen");
    }
    if (departmentId !== me.departmentId) {
      throw ApiError.forbidden("Hanya boleh membuat task untuk departemen sendiri");
    }
  }

  let assignee: string | null = null;
  if (isUuid(body.assignee_employee_id)) {
    const valid = await queryOne<{ id: string }>(
      `SELECT id FROM hris.employees WHERE id = $1 AND department_id = $2 AND is_active`,
      [body.assignee_employee_id, departmentId]
    );
    if (!valid) {
      throw ApiError.badRequest("Penanggung jawab harus karyawan aktif di departemen yang sama");
    }
    assignee = body.assignee_employee_id;
  }

  const created = await queryOne<{ id: string }>(
    `INSERT INTO hris.department_tasks
       (department_id, assignee_employee_id, title, description, recurrence,
        weekly_day, monthly_day, due_date, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      departmentId,
      assignee,
      task.title,
      task.description,
      task.recurrence,
      task.weeklyDay,
      task.monthlyDay,
      task.dueDate,
      me.employeeId,
      me.fullName ?? "—",
    ]
  );

  if (created?.id) {
    for (const [index, subtask] of task.subtasks.entries()) {
      await queryOne(
        `INSERT INTO hris.department_task_subtasks (task_id, title, weight, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [created.id, subtask.title, subtask.weight, index]
      );
    }
  }
  return created?.id;
}

/** Atasan aktif (punya bawahan langsung aktif) di departemen tertentu. */
async function isDepartmentHead(employeeId: string, departmentId: string, requireActive: boolean) {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT (e.department_id = $2 AND EXISTS (
       SELECT 1 FROM hris.employees s WHERE s.reporting_to = e.id AND s.is_active
     )) AS ok
     FROM hris.employees e WHERE e.id = $1 ${requireActive ? "AND e.is_active" : ""}`,
    [employeeId, departmentId]
  );
  return Boolean(row?.ok);
}

/**
 * Nonaktifkan task (is_active=false). Kemunculan lama tetap tersimpan
 * (riwayat & KPI utuh); kemunculan baru berhenti dibuat.
 */
export async function deactivateDeptTask(actor: WorkforceActor, id: string) {
  const task = await queryOne<{ id: string; department_id: string }>(
    `SELECT id, department_id FROM hris.department_tasks WHERE id = $1 AND is_active`,
    [id]
  );
  if (!task) throw ApiError.notFound("Task tidak ditemukan");

  if (!actor.isHr) {
    if (!actor.employeeId) throw ApiError.forbidden("Akun tidak terhubung ke karyawan");
    if (!(await isDepartmentHead(actor.employeeId, task.department_id, false))) {
      throw ApiError.forbidden("Hanya HRD atau atasan departemen ini yang boleh menonaktifkan task");
    }
  }

  await queryOne(
    `UPDATE hris.department_tasks SET is_active = false, updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id]
  );
}

export const occurrenceActionSchema = z.object({
  action: z.enum(["done", "approve", "reject", "check_subtask"], { error: "Aksi tidak dikenal" }),
  notes: z.string().max(2000).nullable().optional(),
  subtask_id: z.string().optional(),
  checked: z.boolean().optional(),
});

type OccurrenceAction = z.infer<typeof occurrenceActionSchema>;

interface OccurrenceRow {
  id: string;
  status: string;
  task_id: string;
  department_id: string;
  assignee_employee_id: string | null;
}

/**
 * Pengerja kemunculan: penanggung jawab (assignee), atau anggota departemen
 * bila task tanpa assignee. HR boleh sebagai cadangan administratif.
 */
async function assertWorker(actor: WorkforceActor, occ: OccurrenceRow) {
  if (occ.status === "approved") throw ApiError.badRequest("Sudah disetujui — tidak bisa diubah");
  if (actor.isHr) return;
  if (!actor.employeeId) throw ApiError.forbidden("Akun ini tidak terhubung ke data karyawan");
  if (occ.assignee_employee_id) {
    if (occ.assignee_employee_id !== actor.employeeId) {
      throw ApiError.forbidden("Hanya penanggung jawab task ini yang boleh mengerjakannya");
    }
    return;
  }
  const inDept = await queryOne<{ id: string }>(
    `SELECT id FROM hris.employees WHERE id = $1 AND department_id = $2 AND is_active`,
    [actor.employeeId, occ.department_id]
  );
  if (!inDept) throw ApiError.forbidden("Hanya anggota departemen ini yang boleh mengerjakannya");
}

/**
 * Aksi pada satu kemunculan task:
 *   done          penanggung jawab menandai selesai
 *   check_subtask ceklis/batal ceklis sub-task berbobot; 100% → 'done' otomatis
 *   approve/reject review HEAD DIVISION (atasan ber-bawahan langsung di
 *                 departemen task; HRD cadangan). Hanya status 'done';
 *                 approved boleh ditolak ulang.
 * Status ini bahan indikator KPI task_completion (approved ÷ jatuh tempo).
 */
export async function runOccurrenceAction(actor: WorkforceActor, id: string, body: OccurrenceAction) {
  const occ = await queryOne<OccurrenceRow>(
    `SELECT o.id, o.status, o.task_id, t.department_id, t.assignee_employee_id
     FROM hris.department_task_occurrences o
     JOIN hris.department_tasks t ON t.id = o.task_id
     WHERE o.id = $1`,
    [id]
  );
  if (!occ) throw ApiError.notFound("Kemunculan task tidak ditemukan");

  const myName = actor.employeeId
    ? ((
        await queryOne<{ full_name: string }>(`SELECT full_name FROM hris.employees WHERE id = $1`, [
          actor.employeeId,
        ])
      )?.full_name ?? "—")
    : "HRD";

  if (body.action === "check_subtask") {
    await assertWorker(actor, occ);
    return checkSubtask(actor, occ, body, myName);
  }

  if (body.action === "done") {
    await assertWorker(actor, occ);
    await queryOne(
      `UPDATE hris.department_task_occurrences
       SET status = 'done', done_at = now(), done_by = $2, done_by_name = $3,
           review_notes = NULL, reviewed_by = NULL, reviewed_by_name = NULL,
           reviewed_at = NULL, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, actor.employeeId, myName]
    );
    return { message: "Task ditandai selesai — menunggu review Head Division" };
  }

  // reviewed_by menyimpan id karyawan (selaras done_by/created_by), bukan id akun.
  const reviewerId = requireLinkedEmployee(
    actor,
    "Akun ini tidak terhubung ke data karyawan, tidak bisa mereview task"
  );
  if (!actor.isHr && !(await isDepartmentHead(reviewerId, occ.department_id, true))) {
    throw ApiError.forbidden("Hanya Head Division departemen ini (atau HRD) yang boleh mereview task");
  }
  if (occ.status !== "done" && !(body.action === "reject" && occ.status === "approved")) {
    throw ApiError.badRequest("Hanya task berstatus selesai yang bisa direview");
  }
  await queryOne(
    `UPDATE hris.department_task_occurrences
     SET status = $2, review_notes = $3, reviewed_by = $4,
         reviewed_by_name = $5, reviewed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING id`,
    [
      id,
      body.action === "approve" ? "approved" : "rejected",
      body.notes?.trim() || null,
      reviewerId,
      myName,
    ]
  );
  return {
    message:
      body.action === "approve"
        ? "Task disetujui"
        : "Task ditolak — penanggung jawab bisa memperbaiki",
  };
}

async function checkSubtask(
  actor: WorkforceActor,
  occ: OccurrenceRow,
  body: OccurrenceAction,
  myName: string
) {
  const subtaskId = String(body.subtask_id || "");
  if (!isUuid(subtaskId)) throw ApiError.badRequest("ID sub-task tidak valid");
  const sub = await queryOne<{ id: string }>(
    `SELECT id FROM hris.department_task_subtasks WHERE id = $1 AND task_id = $2`,
    [subtaskId, occ.task_id]
  );
  if (!sub) throw ApiError.badRequest("Sub-task bukan milik task ini");

  const checked = body.checked === true;
  await queryOne(
    `INSERT INTO hris.department_task_occurrence_items
       (occurrence_id, subtask_id, is_checked, checked_at, checked_by_name, updated_at)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN $4 END, now())
     ON CONFLICT (occurrence_id, subtask_id) DO UPDATE SET
       is_checked = EXCLUDED.is_checked,
       checked_at = EXCLUDED.checked_at,
       checked_by_name = EXCLUDED.checked_by_name,
       updated_at = now()
     RETURNING id`,
    [occ.id, subtaskId, checked, myName]
  );
  // Progres = Σ bobot sub-task tercentang; 100% → 'done' otomatis.
  const agg = await queryOne<{ total: string; done: string }>(
    `SELECT COALESCE(SUM(st.weight), 0) AS total,
            COALESCE(SUM(st.weight) FILTER (WHERE oi.is_checked), 0) AS done
     FROM hris.department_task_subtasks st
     LEFT JOIN hris.department_task_occurrence_items oi
       ON oi.subtask_id = st.id AND oi.occurrence_id = $1
     WHERE st.task_id = $2`,
    [occ.id, occ.task_id]
  );
  const progress = Number(agg?.done ?? 0);
  const total = Number(agg?.total ?? 0);
  const complete = total > 0 && progress >= total - 0.01;
  await queryOne(
    `UPDATE hris.department_task_occurrences
     SET status = CASE WHEN $2::boolean THEN 'done' ELSE 'pending' END,
         done_at = CASE WHEN $2::boolean THEN now() END,
         done_by = CASE WHEN $2::boolean THEN $3::uuid END,
         done_by_name = CASE WHEN $2::boolean THEN $4 END,
         updated_at = now()
     WHERE id = $1 RETURNING id`,
    [occ.id, complete, actor.employeeId, myName]
  );
  return {
    message: complete
      ? "Semua sub-task selesai (100%) — menunggu review Head Division"
      : `Progres ${Math.round(progress)}%`,
    data: { progress, complete },
  };
}
