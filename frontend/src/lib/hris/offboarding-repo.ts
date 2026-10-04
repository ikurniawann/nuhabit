/**
 * Offboarding karyawan: checklist clearance, pengembalian aset, exit
 * interview, dan gaji terakhir. Karyawan boleh mengajukan resign sukarela
 * untuk dirinya; jalur lain hanya HRD/manajer.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import { isLineManagerRole } from "./onboarding-access";
import type { WorkforceActor } from "./workforce-auth";
import { unwrap } from "./workforce-route";

const PERSON = "id, full_name, nip";

export const resignationSchema = z.object({
  resignation_type: z.enum(["voluntary", "termination", "layoff", "end_of_contract"]),
  resignation_date: z.string(),
  last_working_day: z.string(),
  reason: z.string().nullish(),
});

export const offboardingUpdateSchema = z.object({
  clearance_type: z.enum(["hrd", "it", "finance", "manager"]).optional(),
  cleared: z.boolean().optional(),
  notes: z.string().nullish(),
  asset_updates: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["submitted", "notice_period", "exit_interview", "completed"]).optional(),
  exit_interview_date: z.string().nullish(),
  exit_interview_conducted_by: z.string().nullish(),
  exit_interview_notes: z.string().nullish(),
  final_payroll_date: z.string().nullish(),
  final_payroll_amount: z.number().nullish(),
  final_payroll_notes: z.string().nullish(),
});

const PASSTHROUGH_FIELDS = [
  "exit_interview_date",
  "exit_interview_conducted_by",
  "exit_interview_notes",
  "final_payroll_date",
  "final_payroll_amount",
  "final_payroll_notes",
] as const;

export async function listOffboarding(employeeId: string) {
  const db = await createServerPgClient();
  const { data, error } = await db
    .from("offboarding_checklists")
    .select(`
      *,
      employee:employees!employee_id(
        ${PERSON}, photo_url, department:departments(name), job_title:positions(title)
      ),
      interviewer:employees!offboarding_checklists_exit_interview_conducted_by_fkey( ${PERSON} ),
      completer:employees!offboarding_checklists_completed_by_fkey( ${PERSON} )
    `)
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function initiateOffboarding(
  actor: WorkforceActor,
  employeeId: string,
  input: z.infer<typeof resignationSchema>
) {
  const isOwner = actor.employeeId !== null && employeeId === actor.employeeId;
  if (isOwner && input.resignation_type !== "voluntary") {
    throw ApiError.forbidden("Only HRD/Manager can initiate non-voluntary resignation");
  }
  if (!isLineManagerRole(actor.role) && !isOwner) throw ApiError.forbidden("Forbidden");

  const db = await createServerPgClient();
  const { data: employee } = await db
    .from("employees")
    .select("id, full_name, employment_status, is_active")
    .eq("id", employeeId)
    .maybeSingle();
  if (!employee || !employee.is_active) throw ApiError.notFound("Employee not found or inactive");

  const { data: existing } = await db
    .from("offboarding_checklists")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("status", "submitted")
    .maybeSingle();
  if (existing) {
    throw ApiError.badRequest("Offboarding already initiated for this employee", {
      offboarding_id: existing.id,
    });
  }

  return unwrap(
    await db
      .from("offboarding_checklists")
      .insert({
        employee_id: employeeId,
        resignation_type: input.resignation_type,
        resignation_date: input.resignation_date,
        last_working_day: input.last_working_day,
        reason: input.reason || null,
        status: "submitted",
        asset_return_status: {},
      })
      .select(`*, employee:employees!employee_id( ${PERSON}, department:departments(name) )`)
      .single()
  );
}

/** Perbarui clearance, aset, status, exit interview, atau gaji terakhir (HRD/manajer). */
export async function updateOffboarding(
  actor: WorkforceActor,
  employeeId: string,
  input: z.infer<typeof offboardingUpdateSchema>
) {
  if (!isLineManagerRole(actor.role)) {
    throw ApiError.forbidden("Forbidden: Only HRD or managers can update offboarding");
  }
  const db = await createServerPgClient();
  const { data: offboarding } = await db
    .from("offboarding_checklists")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!offboarding) throw ApiError.notFound("Offboarding not found for this employee");

  const update: Record<string, unknown> = {};
  if (input.clearance_type) {
    if (input.cleared !== undefined) update[`clearance_${input.clearance_type}`] = input.cleared;
    if (input.notes !== undefined) update[`clearance_${input.clearance_type}_notes`] = input.notes;
  }
  if (input.asset_updates) {
    update.asset_return_status = { ...(offboarding.asset_return_status || {}), ...input.asset_updates };
  }
  if (input.status) {
    update.status = input.status;
    if (input.status === "completed") {
      update.completed_at = new Date().toISOString();
      // completed_by ber-FK ke hris.employees
      update.completed_by = actor.employeeId;
    }
  }
  for (const field of PASSTHROUGH_FIELDS) {
    if (input[field] !== undefined) update[field] = input[field];
  }

  return unwrap(
    await db
      .from("offboarding_checklists")
      .update(update)
      .eq("id", offboarding.id)
      .select(`*, employee:employees!employee_id( ${PERSON} )`)
      .single()
  );
}
