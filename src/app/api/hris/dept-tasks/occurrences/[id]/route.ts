import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * PATCH /api/hris/dept-tasks/occurrences/[id] — aksi pada satu kemunculan
 * task departemen:
 *   action 'done'    — penanggung jawab (assignee; atau anggota departemen
 *                      bila task tanpa assignee) menandai selesai.
 *   action 'approve' / 'reject' — review HEAD DIVISION (owner 2026-08-31:
 *                      atasan ber-bawahan langsung di departemen task ini,
 *                      bukan HRD; HRD tetap boleh sebagai cadangan
 *                      administratif). Hanya kemunculan berstatus 'done';
 *                      rejected boleh ditandai 'done' ulang.
 *   action 'check_subtask' — ceklis/batal ceklis satu sub-task berbobot;
 *                      saat total bobot tercentang mencapai 100%, status
 *                      otomatis 'done' (menunggu review); sebagian →
 *                      'in_progress' (EPIC-068).
 *   action 'progress' — penanggung jawab mencatat progres (EPIC-068):
 *                      status 'in_progress', catatan, dan persen 0–99
 *                      (persen hanya untuk task tanpa sub-task; task
 *                      bersub-task memakai bobot ceklis).
 * Status ini bahan indikator KPI task_completion (approved ÷ jatuh tempo).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PatchBody {
  action?: "done" | "approve" | "reject" | "check_subtask" | "progress";
  progress_percent?: number | null;
  notes?: string | null;
  /** Catatan progres (action 'progress'). */
  note?: string | null;
  subtask_id?: string;
  checked?: boolean;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }
    const body = (await req.json()) as PatchBody;
    const action = body.action;
    if (!["done", "approve", "reject", "check_subtask", "progress"].includes(String(action))) {
      return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
    }

    const occ = await queryOne<{
      id: string;
      status: string;
      task_id: string;
      department_id: string;
      assignee_employee_id: string | null;
    }>(
      `SELECT o.id, o.status, o.task_id, t.department_id, t.assignee_employee_id
       FROM hris.department_task_occurrences o
       JOIN hris.department_tasks t ON t.id = o.task_id
       WHERE o.id = $1`,
      [id]
    );
    if (!occ) return NextResponse.json({ error: "Kemunculan task tidak ditemukan" }, { status: 404 });

    const myName = actor.employeeId
      ? (
          await queryOne<{ full_name: string }>(
            `SELECT full_name FROM hris.employees WHERE id = $1`,
            [actor.employeeId]
          )
        )?.full_name ?? "—"
      : "HRD";

    const workerGate = async (): Promise<NextResponse | null> => {
      if (occ.status === "approved") {
        return NextResponse.json({ error: "Sudah disetujui — tidak bisa diubah" }, { status: 400 });
      }
      if (actor.isHr) return null;
      if (!actor.employeeId) {
        return NextResponse.json({ error: "Akun ini tidak terhubung ke data karyawan" }, { status: 403 });
      }
      if (occ.assignee_employee_id) {
        if (occ.assignee_employee_id !== actor.employeeId) {
          return NextResponse.json(
            { error: "Hanya penanggung jawab task ini yang boleh mengerjakannya" },
            { status: 403 }
          );
        }
        return null;
      }
      const inDept = await queryOne<{ id: string }>(
        `SELECT id FROM hris.employees WHERE id = $1 AND department_id = $2 AND is_active`,
        [actor.employeeId, occ.department_id]
      );
      if (!inDept) {
        return NextResponse.json(
          { error: "Hanya anggota departemen ini yang boleh mengerjakannya" },
          { status: 403 }
        );
      }
      return null;
    };

    if (action === "check_subtask") {
      const gate = await workerGate();
      if (gate) return gate;
      const subtaskId = String(body.subtask_id || "");
      if (!UUID_RE.test(subtaskId)) {
        return NextResponse.json({ error: "ID sub-task tidak valid" }, { status: 400 });
      }
      const sub = await queryOne<{ id: string }>(
        `SELECT id FROM hris.department_task_subtasks WHERE id = $1 AND task_id = $2`,
        [subtaskId, occ.task_id]
      );
      if (!sub) {
        return NextResponse.json({ error: "Sub-task bukan milik task ini" }, { status: 400 });
      }
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
        [id, subtaskId, checked, myName]
      );
      // Progres = Σ bobot sub-task tercentang; 100% → 'done' otomatis.
      const agg = await queryOne<{ total: string; done: string }>(
        `SELECT COALESCE(SUM(st.weight), 0) AS total,
                COALESCE(SUM(st.weight) FILTER (
                  WHERE oi.is_checked
                ), 0) AS done
         FROM hris.department_task_subtasks st
         LEFT JOIN hris.department_task_occurrence_items oi
           ON oi.subtask_id = st.id AND oi.occurrence_id = $1
         WHERE st.task_id = $2`,
        [id, occ.task_id]
      );
      const progress = Number(agg?.done ?? 0);
      const complete = Number(agg?.total ?? 0) > 0 && progress >= Number(agg?.total) - 0.01;
      await queryOne(
        `UPDATE hris.department_task_occurrences
         SET status = CASE WHEN $2::boolean THEN 'done' WHEN $5::numeric > 0 THEN 'in_progress' ELSE 'pending' END,
             started_at = CASE WHEN $5::numeric > 0 THEN COALESCE(started_at, now()) ELSE started_at END,
             done_at = CASE WHEN $2::boolean THEN now() END,
             done_by = CASE WHEN $2::boolean THEN $3::uuid END,
             done_by_name = CASE WHEN $2::boolean THEN $4 END,
             updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, complete, actor.employeeId, myName, progress]
      );
      return NextResponse.json({
        message: complete
          ? "Semua sub-task selesai (100%) — menunggu review Head Division"
          : `Progres ${Math.round(progress)}%`,
        data: { progress, complete },
      });
    }

    if (action === "progress") {
      const gate = await workerGate();
      if (gate) return gate;
      if (occ.status === "done") {
        return NextResponse.json({ error: "Task sudah ditandai selesai — menunggu review" }, { status: 400 });
      }
      const note = String(body.note ?? body.notes ?? "").trim().slice(0, 500) || null;
      const hasSubtasks = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM hris.department_task_subtasks WHERE task_id = $1`,
        [occ.task_id]
      );
      let percent: number | null = null;
      if (body.progress_percent !== undefined && body.progress_percent !== null) {
        if ((hasSubtasks?.n ?? 0) > 0) {
          return NextResponse.json(
            { error: "Task ini memakai sub-task — progres dihitung dari ceklis sub-task" },
            { status: 400 }
          );
        }
        const p = Number(body.progress_percent);
        if (!Number.isInteger(p) || p < 0 || p > 99) {
          return NextResponse.json(
            { error: "Progres 0–99% (untuk 100% pakai Tandai Selesai)" },
            { status: 400 }
          );
        }
        percent = p;
      }
      if (note === null && percent === null) {
        return NextResponse.json({ error: "Isi catatan atau persen progres" }, { status: 400 });
      }
      await queryOne(
        `UPDATE hris.department_task_occurrences
         SET status = 'in_progress', started_at = COALESCE(started_at, now()),
             progress_percent = COALESCE($2::smallint, progress_percent), updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, percent]
      );
      await queryOne(
        `INSERT INTO hris.department_task_updates (occurrence_id, note, progress_percent, author_employee_id, author_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [id, note, percent, actor.employeeId, myName]
      );
      return NextResponse.json({ message: "Progres dicatat — status Sedang dikerjakan" });
    }

    if (action === "done") {
      const gate = await workerGate();
      if (gate) return gate;
      await queryOne(
        `UPDATE hris.department_task_occurrences
         SET status = 'done', done_at = now(), done_by = $2, done_by_name = $3,
             review_notes = NULL, reviewed_by = NULL, reviewed_by_name = NULL,
             reviewed_at = NULL, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, myName]
      );
      return NextResponse.json({ message: "Task ditandai selesai — menunggu review Head Division" });
    }

    // approve / reject — review HEAD DIVISION departemen task ini (atasan
    // ber-bawahan langsung); HRD tetap boleh sebagai cadangan administratif.
    if (!actor.isHr) {
      if (!actor.employeeId) {
        return NextResponse.json({ error: "Akun ini tidak terhubung ke data karyawan" }, { status: 403 });
      }
      const isHead = await queryOne<{ ok: boolean }>(
        `SELECT (e.department_id = $2 AND EXISTS (
           SELECT 1 FROM hris.employees s WHERE s.reporting_to = e.id AND s.is_active
         )) AS ok
         FROM hris.employees e WHERE e.id = $1 AND e.is_active`,
        [actor.employeeId, occ.department_id]
      );
      if (!isHead?.ok) {
        return NextResponse.json(
          { error: "Hanya Head Division departemen ini (atau HRD) yang boleh mereview task" },
          { status: 403 }
        );
      }
    }
    if (occ.status !== "done" && !(action === "reject" && occ.status === "approved")) {
      return NextResponse.json(
        { error: "Hanya task berstatus selesai yang bisa direview" },
        { status: 400 }
      );
    }
    await queryOne(
      `UPDATE hris.department_task_occurrences
       SET status = $2, review_notes = $3, reviewed_by = $4,
           reviewed_by_name = $5, reviewed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id`,
      [
        id,
        action === "approve" ? "approved" : "rejected",
        body.notes?.trim() || null,
        actor.userId,
        myName,
      ]
    );
    return NextResponse.json({
      message: action === "approve" ? "Task disetujui" : "Task ditolak — penanggung jawab bisa memperbaiki",
    });
  } catch (error) {
    console.error("[dept-tasks/occurrence] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
