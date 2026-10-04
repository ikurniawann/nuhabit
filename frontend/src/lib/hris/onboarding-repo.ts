/**
 * Checklist onboarding karyawan baru. HRD/manajer mengelola tugas; karyawan
 * ybs boleh melihat dan menyelesaikan tugas yang ditugaskan kepadanya.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import { isLineManagerRole } from "./onboarding-access";
import type { WorkforceActor } from "./workforce-auth";
import { unwrap } from "./workforce-route";

const PERSON = "id, full_name, nip";
const CATEGORIES = ["admin", "it", "hr", "manager", "general"] as const;
const INVALID_ACTION = 'Invalid action. Use "complete" with task_id or "add" with task details';

export const onboardingListQuerySchema = z.object({
  category: z.string().optional(),
  completed: z.string().optional(), // "true" | "false" | lainnya = semua
});

const taskFields = {
  task_name: z.string().min(1).optional(),
  category: z.enum(CATEGORIES).optional(),
  description: z.string().nullish(),
  priority: z.number().int().min(1).max(3).optional(),
  due_date: z.string().nullish(),
  assigned_to: z.string().nullish(),
};

export const onboardingPostSchema = z.object({
  action: z.string().optional(),
  task_id: z.string().optional(),
  completion_notes: z.string().nullish(),
  ...taskFields,
});

export const onboardingPutSchema = z.object({
  task_id: z.string({ error: "task_id is required" }).min(1, "task_id is required"),
  ...taskFields,
});

/** Ringkasan progres checklist (persen dibulatkan). */
export function onboardingSummary(tasks: { completed: boolean }[]) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.completed).length;
  return {
    total,
    completed,
    pending: total - completed,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export async function listOnboarding(employeeId: string, q: z.infer<typeof onboardingListQuerySchema>) {
  const db = await createServerPgClient();
  let query = db
    .from("onboarding_checklists")
    .select(`
      *,
      employee:employees!employee_id(
        ${PERSON}, photo_url, department:departments(name), job_title:positions(title), join_date
      ),
      completer:employees!onboarding_checklists_completed_by_fkey( ${PERSON} ),
      assignee:employees!onboarding_checklists_assigned_to_fkey( ${PERSON} )
    `)
    .eq("employee_id", employeeId);
  if (q.category) query = query.eq("category", q.category);
  if (q.completed === "true") query = query.eq("completed", true);
  else if (q.completed === "false") query = query.eq("completed", false);

  const { data, error } = await query
    .order("priority", { ascending: true })
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);
  const tasks = (data ?? []) as { completed: boolean }[];
  return { data: tasks, summary: onboardingSummary(tasks) };
}

/**
 * action=complete: HRD/manajer, atau karyawan yang ditugaskan.
 * action=add: HRD/manajer menambah tugas.
 * Kolom completed_by/assigned_to ber-FK ke hris.employees.
 */
export async function actOnOnboarding(
  actor: WorkforceActor,
  employeeId: string,
  input: z.infer<typeof onboardingPostSchema>
) {
  const isManager = isLineManagerRole(actor.role);
  const isOwner = actor.employeeId !== null && employeeId === actor.employeeId;
  if (!isManager && !isOwner) throw ApiError.forbidden("Forbidden");

  const db = await createServerPgClient();

  if (input.action === "complete" && input.task_id) {
    if (!isManager) {
      const { data: task } = await db
        .from("onboarding_checklists")
        .select("assigned_to")
        .eq("id", input.task_id)
        .eq("employee_id", employeeId)
        .maybeSingle();
      if (!task || task.assigned_to !== actor.employeeId) {
        throw ApiError.forbidden("Forbidden: Not authorized to complete this task");
      }
    }
    const data = unwrap(
      await db
        .from("onboarding_checklists")
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          completed_by: actor.employeeId,
          completion_notes: input.completion_notes || null,
        })
        .eq("id", input.task_id)
        .eq("employee_id", employeeId)
        .select()
        .single()
    );
    return { message: "Task completed successfully", data };
  }

  if (input.action === "add" && isManager) {
    if (!input.task_name || !input.category) {
      throw ApiError.badRequest("task_name dan category wajib diisi");
    }
    const data = unwrap(
      await db
        .from("onboarding_checklists")
        .insert({
          employee_id: employeeId,
          task_name: input.task_name,
          category: input.category,
          description: input.description,
          priority: input.priority || 3,
          due_date: input.due_date,
          assigned_to: input.assigned_to || actor.employeeId,
        })
        .select()
        .single()
    );
    return { message: "Task added successfully", data };
  }

  throw ApiError.badRequest(INVALID_ACTION);
}

/** HRD/manajer mengubah satu tugas milik karyawan ini. */
export async function updateOnboardingTask(
  actor: WorkforceActor,
  employeeId: string,
  input: z.infer<typeof onboardingPutSchema>
) {
  if (!isLineManagerRole(actor.role)) {
    throw ApiError.forbidden("Forbidden: Only HRD or managers can update tasks");
  }
  const { task_id, ...fields } = input;
  const db = await createServerPgClient();
  const data = unwrap(
    await db
      .from("onboarding_checklists")
      .update(fields)
      .eq("id", task_id)
      .eq("employee_id", employeeId)
      .select()
      .single()
  );
  return { message: "Task updated successfully", data };
}
