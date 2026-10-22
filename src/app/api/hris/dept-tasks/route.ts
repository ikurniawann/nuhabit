import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { deptTaskActor as actorProfile, ensureOccurrences, type TaskRecurrence } from "@/lib/hris/dept-tasks";

/**
 * Task Departemen (owner 2026-08-30, konsep MBO/task compliance).
 *
 * GET  ?month=YYYY-MM[&department_id=..] — daftar task + kemunculannya
 *      pada bulan itu. HR melihat departemen mana pun; karyawan lain
 *      hanya departemennya sendiri.
 * POST — buat task baru. HR bebas; non-HR harus ATASAN (punya bawahan
 *      langsung) dan hanya untuk departemennya sendiri.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const RECURRENCES: TaskRecurrence[] = ["once", "daily", "weekly", "monthly"];

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function GET(req: NextRequest) {
  try {
    const me = await actorProfile();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const month = req.nextUrl.searchParams.get("month") ?? "";
    if (!MONTH_RE.test(month)) {
      return NextResponse.json({ error: "Parameter month wajib (YYYY-MM)" }, { status: 400 });
    }
    const requested = req.nextUrl.searchParams.get("department_id");
    let departmentId = me.departmentId;
    if (me.isHr && requested && UUID_RE.test(requested)) departmentId = requested;
    const departments = me.isHr
      ? await query(`SELECT id, name FROM hris.departments ORDER BY name`)
      : [];
    if (!departmentId) {
      return NextResponse.json({
        data: {
          department_id: null, tasks: [], occurrences: [], members: [],
          departments, can_manage: me.isHr, is_hr: me.isHr,
        },
      });
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
                o.done_at, o.done_by_name, o.review_notes, o.reviewed_by_name,
                o.progress_percent, o.started_at,
                lu.note AS last_note, lu.author_name AS last_note_by, lu.created_at AS last_note_at
         FROM hris.department_task_occurrences o
         LEFT JOIN LATERAL (
           SELECT note, author_name, created_at FROM hris.department_task_updates
           WHERE occurrence_id = o.id AND note IS NOT NULL ORDER BY created_at DESC LIMIT 1
         ) lu ON true
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

    return NextResponse.json({
      data: {
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
      },
    });
  } catch (error) {
    console.error("[dept-tasks] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PostBody {
  department_id?: string;
  assignee_employee_id?: string | null;
  title?: string;
  description?: string | null;
  recurrence?: string;
  weekly_day?: number | null;
  monthly_day?: number | null;
  due_date?: string | null;
  /** Sub-task (owner 2026-08-31): bobot dihitung otomatis dibagi rata. */
  subtasks?: { title?: string }[];
}

export async function POST(req: NextRequest) {
  try {
    const me = await actorProfile();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as PostBody;
    const title = String(body.title || "").trim();
    if (title.length < 3) {
      return NextResponse.json({ error: "Judul task minimal 3 karakter" }, { status: 400 });
    }
    const recurrence = String(body.recurrence || "once") as TaskRecurrence;
    if (!RECURRENCES.includes(recurrence)) {
      return NextResponse.json({ error: "Jenis pengulangan tidak dikenal" }, { status: 400 });
    }
    if (recurrence === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date || ""))) {
      return NextResponse.json({ error: "Task sekali jalan membutuhkan tanggal jatuh tempo" }, { status: 400 });
    }
    if (recurrence === "weekly") {
      const d = Number(body.weekly_day);
      if (!Number.isInteger(d) || d < 1 || d > 7) {
        return NextResponse.json({ error: "Task mingguan membutuhkan hari (Senin–Minggu)" }, { status: 400 });
      }
    }
    if (recurrence === "monthly") {
      const d = Number(body.monthly_day);
      if (!Number.isInteger(d) || d < 1 || d > 28) {
        return NextResponse.json({ error: "Task bulanan membutuhkan tanggal 1–28" }, { status: 400 });
      }
    }

    // Departemen sasaran: HR bebas memilih; non-HR wajib atasan & hanya
    // departemennya sendiri.
    let departmentId = me.departmentId;
    if (me.isHr && body.department_id && UUID_RE.test(body.department_id)) {
      departmentId = body.department_id;
    }
    if (!departmentId) {
      return NextResponse.json({ error: "Departemen tidak diketahui" }, { status: 400 });
    }
    if (!me.isHr) {
      if (!me.hasSubordinates) {
        return NextResponse.json(
          { error: "Hanya HRD atau atasan (kepala tim) yang boleh membuat task departemen" },
          { status: 403 }
        );
      }
      if (departmentId !== me.departmentId) {
        return NextResponse.json({ error: "Hanya boleh membuat task untuk departemen sendiri" }, { status: 403 });
      }
    }

    // Sub-task: 100% task dibagi RATA otomatis (owner 2026-08-31 — tanpa
    // input bobot). Sisa pembulatan ditempel ke sub-task terakhir supaya
    // totalnya persis 100.00.
    const subtitles = (body.subtasks ?? [])
      .map((st) => String(st.title || "").trim())
      .filter((title) => title.length > 0);
    if (subtitles.length > 50) {
      return NextResponse.json({ error: "Maksimal 50 sub-task" }, { status: 400 });
    }
    const rata = subtitles.length > 0
      ? Math.floor((100 / subtitles.length) * 100) / 100
      : 0;
    const subtasks = subtitles.map((title, index) => ({
      title,
      weight:
        index === subtitles.length - 1
          ? Math.round((100 - rata * (subtitles.length - 1)) * 100) / 100
          : rata,
    }));

    let assignee: string | null = null;
    if (body.assignee_employee_id && UUID_RE.test(body.assignee_employee_id)) {
      const valid = await queryOne<{ id: string }>(
        `SELECT id FROM hris.employees WHERE id = $1 AND department_id = $2 AND is_active`,
        [body.assignee_employee_id, departmentId]
      );
      if (!valid) {
        return NextResponse.json(
          { error: "Penanggung jawab harus karyawan aktif di departemen yang sama" },
          { status: 400 }
        );
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
        title,
        body.description?.trim() || null,
        recurrence,
        recurrence === "weekly" ? Number(body.weekly_day) : null,
        recurrence === "monthly" ? Number(body.monthly_day) : null,
        recurrence === "once" ? body.due_date : null,
        me.employeeId,
        me.fullName ?? "—",
      ]
    );

    if (created?.id && subtasks.length > 0) {
      for (const [index, st] of subtasks.entries()) {
        await queryOne(
          `INSERT INTO hris.department_task_subtasks (task_id, title, weight, sort_order)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [created.id, st.title, st.weight, index]
        );
      }
    }

    return NextResponse.json({ message: "Task dibuat", data: { id: created?.id } }, { status: 201 });
  } catch (error) {
    console.error("[dept-tasks] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
