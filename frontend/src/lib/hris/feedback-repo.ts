import { ApiError } from "@/lib/api/auth";
import { createPgClient, createServerPgClient } from "@/lib/pg/create-client";
import type { z } from "zod";
import type {
  feedbackAssignmentSchema,
  feedbackAssignmentUpdateSchema,
  feedbackCategorySchema,
  feedbackCycleSchema,
  feedbackCycleUpdateSchema,
  feedbackResponseSchema,
  feedbackResponseUpdateSchema,
  feedbackSummarySchema,
} from "./feedback-schemas";
import { computeFinalScore } from "./feedback-scoring";
import { unwrap, unwrapSingle } from "./workforce-route";

/**
 * Modul 360 feedback (performance.feedback_*). Belum punya UI; route-nya
 * khusus pengelola kinerja. Query lewat query builder pg.
 */

type OneOrMany<T> = T | T[];
const asArray = <T>(value: OneOrMany<T>): T[] => (Array.isArray(value) ? value : [value]);

export interface Pagination {
  page: number;
  limit: number;
  from: number;
  to: number;
}

export function parsePagination(params: URLSearchParams, defaultLimit: number): Pagination {
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1);
  const limit = Math.max(1, parseInt(params.get("limit") || String(defaultLimit)) || defaultLimit);
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

export function paginationMeta({ page, limit }: Pagination, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/** Id & email akun login (auth.users); dipakai memetakan ke record karyawan. */
async function authIdentity() {
  const authClient = await createServerPgClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) throw ApiError.unauthorized("Unauthorized");
  return { id: user.id, email: user.email ?? null };
}

async function employeeIdByEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const { data } = await createPgClient().from("employees").select("id").eq("email", email).single();
  return data?.id ?? null;
}

/** Record karyawan pemberi keputusan (approved_by), dicocokkan lewat email akun. */
export async function requireApproverEmployeeId(notFoundMessage: string): Promise<string> {
  const id = await employeeIdByEmail((await authIdentity()).email);
  if (!id) throw ApiError.notFound(notFoundMessage);
  return id;
}

/**
 * created_by siklus (NOT NULL, FK employees): karyawan yang tertaut akun
 * (user_id), lalu yang emailnya sama. Akun tanpa record karyawan ditolak,
 * jangan menebak karyawan lain sebagai pembuat.
 */
async function resolveCycleCreator(): Promise<string> {
  const identity = await authIdentity();
  const { data: linked } = await createPgClient()
    .from("employees")
    .select("id")
    .eq("user_id", identity.id)
    .maybeSingle();
  const id = linked?.id ?? (await employeeIdByEmail(identity.email));
  if (!id) {
    throw ApiError.forbidden(
      "Akun ini tidak terhubung ke data karyawan, tidak bisa membuat siklus feedback"
    );
  }
  return id;
}

/* ---------------------------------------------------------------- */
/* Persetujuan self-assessment                                       */
/* ---------------------------------------------------------------- */

const APPROVAL_SELECT = `*,
  employee:employees!feedback_assignments_employee_id_fkey(
    id, nip, full_name, email,
    department:departments(name),
    position:positions(title)
  ),
  reviewer:employees!feedback_assignments_reviewer_id_fkey(id, nip, full_name),
  cycle:feedback_cycles(id, name, period_label, status),
  responses:feedback_responses(
    id, rating, comments,
    criteria:feedback_criteria(name, category:feedback_categories(name))
  )`;

/** Self-assessment yang menunggu/selesai diputuskan atasan. */
export async function listApprovals(status: string, pagination: Pagination) {
  let builder = createPgClient()
    .from("feedback_assignments")
    .select(APPROVAL_SELECT, { count: "exact" })
    .eq("relationship_type", "self");

  if (status === "pending" || status === "submitted") builder = builder.eq("status", "submitted");
  else if (status === "approved" || status === "rejected") builder = builder.eq("status", status);
  else if (status === "all") builder = builder.in("status", ["submitted", "approved", "rejected"]);

  const { data, error, count } = await builder
    .range(pagination.from, pagination.to)
    .order("submitted_at", { ascending: false });
  const rows = (unwrap({ data, error }) ?? []) as { status: string }[];
  const countStatus = (value: string) => rows.filter((row) => row.status === value).length;
  return {
    rows,
    total: count || 0,
    stats: {
      total: count || 0,
      pending: countStatus("submitted"),
      approved: countStatus("approved"),
      rejected: countStatus("rejected"),
    },
  };
}

export type FeedbackDecision =
  | { action: "approve"; comments?: string | null }
  | { action: "reject"; reason: string };

function decisionUpdate(decision: FeedbackDecision, approverId: string) {
  return {
    status: decision.action === "approve" ? "approved" : "rejected",
    approved_by: approverId,
    approved_at: new Date().toISOString(),
    ...(decision.action === "approve"
      ? { manager_comments: decision.comments ?? null }
      : { rejection_reason: decision.reason }),
  };
}

export async function decideAssignments(ids: string[], decision: FeedbackDecision, approverId: string) {
  return unwrap(
    await createPgClient()
      .from("feedback_assignments")
      .update(decisionUpdate(decision, approverId))
      .in("id", ids)
      .select(`*, employee:employees!feedback_assignments_employee_id_fkey(full_name, nip)`)
  );
}

export async function decideAssignment(
  id: string,
  decision: FeedbackDecision,
  approverId: string,
  employeeJoin = "employees!feedback_assignments_employee_id_fkey"
) {
  return unwrap(
    await createPgClient()
      .from("feedback_assignments")
      .update(decisionUpdate(decision, approverId))
      .eq("id", id)
      .select(
        `*,
          employee:${employeeJoin}(id, full_name, nip, email),
          cycle:feedback_cycles(name, period_label)`
      )
      .single()
  );
}

/* ---------------------------------------------------------------- */
/* Penugasan reviewer                                                */
/* ---------------------------------------------------------------- */

const ASSIGNMENT_FILTERS = ["cycle_id", "employee_id", "reviewer_id", "status", "relationship_type"] as const;

export async function listAssignments(params: URLSearchParams, pagination: Pagination) {
  let builder = createPgClient()
    .from("feedback_assignments")
    .select(
      `*,
        cycle:feedback_cycles(id, name, period_label, status),
        employee:employees!employee_id(id, full_name, nip, department:departments(name), position:positions(title)),
        reviewer:employees!reviewer_id(id, full_name, nip)`,
      { count: "exact" }
    );
  for (const key of ASSIGNMENT_FILTERS) {
    const value = params.get(key);
    if (value) builder = builder.eq(key, value);
  }
  const { data, error, count } = await builder
    .range(pagination.from, pagination.to)
    .order("created_at", { ascending: false });
  return { rows: unwrap({ data, error }) ?? [], total: count || 0 };
}

export async function createAssignments(input: OneOrMany<z.infer<typeof feedbackAssignmentSchema>>) {
  await authIdentity();
  return unwrap(
    await createPgClient()
      .from("feedback_assignments")
      .insert(asArray(input))
      .select(
        `*,
          cycle:feedback_cycles(id, name, period_label),
          employee:employees!employee_id(id, full_name, nip),
          reviewer:employees!reviewer_id(id, full_name)`
      )
  );
}

export async function getAssignment(id: string) {
  return unwrapSingle(
    await createPgClient()
      .from("feedback_assignments")
      .select(
        `*,
          cycle:feedback_cycles(id, name, period_label, is_anonymous),
          employee:employees!employee_id(id, full_name, nip, department:departments(name), position:positions(title)),
          reviewer:employees!reviewer_id(id, full_name, nip, department:departments(name)),
          responses:feedback_responses(
            *,
            criteria:feedback_criteria(id, name, description, category:feedback_categories(id, name))
          )`
      )
      .eq("id", id)
      .single(),
    "Assignment not found"
  );
}

export async function updateAssignment(id: string, body: z.infer<typeof feedbackAssignmentUpdateSchema>) {
  await authIdentity();
  // submitted_at otomatis saat status berubah ke submitted
  const patch =
    body.status === "submitted" && !body.submitted_at
      ? { ...body, submitted_at: new Date().toISOString() }
      : body;
  return unwrap(
    await createPgClient().from("feedback_assignments").update(patch).eq("id", id).select().single()
  );
}

export async function deleteAssignment(id: string) {
  const { error } = await createPgClient().from("feedback_assignments").delete().eq("id", id);
  unwrap({ data: null, error });
}

/* ---------------------------------------------------------------- */
/* Kategori & siklus                                                 */
/* ---------------------------------------------------------------- */

export async function listCategories() {
  const data = unwrap(
    await createPgClient()
      .from("feedback_categories")
      .select(`*, criteria:feedback_criteria(id, name, description, display_order)`)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
  );
  return data ?? [];
}

export async function createCategory(input: z.infer<typeof feedbackCategorySchema>) {
  return unwrap(await createPgClient().from("feedback_categories").insert(input).select().single());
}

export async function listCycles(params: URLSearchParams, pagination: Pagination) {
  let builder = createPgClient()
    .from("feedback_cycles")
    .select(
      `*,
        created_by:employees!created_by(id, full_name),
        assignments_count:feedback_assignments(count),
        summaries_count:feedback_summaries(count)`,
      { count: "exact" }
    );
  const status = params.get("status");
  const periodLabel = params.get("period_label");
  if (status) builder = builder.eq("status", status);
  if (periodLabel) builder = builder.eq("period_label", periodLabel);
  const { data, error, count } = await builder
    .range(pagination.from, pagination.to)
    .order("created_at", { ascending: false });
  return { rows: unwrap({ data, error }) ?? [], total: count || 0 };
}

export async function createCycle(input: z.infer<typeof feedbackCycleSchema>) {
  const createdBy = await resolveCycleCreator();
  return unwrap(
    await createPgClient()
      .from("feedback_cycles")
      .insert({ ...input, created_by: createdBy })
      .select()
      .single()
  );
}

export async function getCycle(id: string) {
  return unwrapSingle(
    await createPgClient()
      .from("feedback_cycles")
      .select(
        `*,
          created_by:employees!created_by(id, full_name),
          assignments:feedback_assignments(
            *,
            employee:employees!employee_id(id, full_name, nip),
            reviewer:employees!reviewer_id(id, full_name)
          ),
          summaries:feedback_summaries(
            *,
            employee:employees!employee_id(id, full_name, department:departments(name))
          )`
      )
      .eq("id", id)
      .single(),
    "Cycle not found"
  );
}

export async function updateCycle(id: string, body: z.infer<typeof feedbackCycleUpdateSchema>) {
  await authIdentity();
  return unwrap(
    await createPgClient()
      .from("feedback_cycles")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()
  );
}

export async function deleteCycle(id: string) {
  const { error } = await createPgClient().from("feedback_cycles").delete().eq("id", id);
  unwrap({ data: null, error });
}

/* ---------------------------------------------------------------- */
/* Jawaban & ringkasan                                               */
/* ---------------------------------------------------------------- */

export async function listResponses(params: URLSearchParams, pagination: Pagination) {
  let builder = createPgClient()
    .from("feedback_responses")
    .select(
      `*,
        assignment:feedback_assignments(
          id,
          employee:employees!employee_id(id, full_name),
          reviewer:employees!reviewer_id(id, full_name),
          relationship_type
        ),
        criteria:feedback_criteria(
          id, name, description,
          category:feedback_categories(id, name, weight)
        )`,
      { count: "exact" }
    );
  const assignmentId = params.get("assignment_id");
  const criteriaId = params.get("criteria_id");
  if (assignmentId) builder = builder.eq("assignment_id", assignmentId);
  if (criteriaId) builder = builder.eq("criteria_id", criteriaId);
  const { data, error, count } = await builder
    .range(pagination.from, pagination.to)
    .order("created_at", { ascending: false });
  return { rows: unwrap({ data, error }) ?? [], total: count || 0 };
}

/**
 * Simpan jawaban (satu atau bulk). Untuk satu jawaban: bila semua kriteria
 * sudah terjawab, penugasan otomatis ditandai submitted.
 */
export async function createResponses(input: OneOrMany<z.infer<typeof feedbackResponseSchema>>) {
  await authIdentity();
  const db = createPgClient();
  const data = unwrap(
    await db
      .from("feedback_responses")
      .insert(asArray(input))
      .select(`*, criteria:feedback_criteria(id, name, category:feedback_categories(name))`)
  );

  if (!Array.isArray(input)) {
    const { data: allCriteria } = await db.from("feedback_criteria").select("id", { count: "exact" });
    const { data: answered } = await db
      .from("feedback_responses")
      .select("criteria_id")
      .eq("assignment_id", input.assignment_id);
    if (allCriteria && answered && answered.length >= allCriteria.length) {
      await db
        .from("feedback_assignments")
        .update({ status: "submitted", submitted_at: new Date().toISOString() })
        .eq("id", input.assignment_id);
    }
  }
  return data;
}

export async function getResponse(id: string) {
  const { data, error } = await createPgClient()
    .from("feedback_responses")
    .select(
      `*,
        assignment:feedback_assignments(
          id, status, relationship_type,
          employee:employees(id, full_name, nip),
          reviewer:employees(id, full_name, nip),
          cycle:feedback_cycles(id, name, period_label)
        ),
        criteria:feedback_criteria(id, name, category_id)`
    )
    .eq("id", id)
    .single();
  if (error || !data) throw ApiError.notFound("Response not found");
  return data;
}

export async function updateResponse(id: string, body: z.infer<typeof feedbackResponseUpdateSchema>) {
  await authIdentity();
  return unwrap(
    await createPgClient()
      .from("feedback_responses")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()
  );
}

export async function deleteResponse(id: string) {
  await authIdentity();
  const { error } = await createPgClient().from("feedback_responses").delete().eq("id", id);
  unwrap({ data: null, error });
}

export async function listSummaries(params: URLSearchParams, pagination: Pagination) {
  let builder = createPgClient()
    .from("feedback_summaries")
    .select(
      `*,
        cycle:feedback_cycles(id, name, period_label, status),
        employee:employees!employee_id(
          id, full_name, nip, email,
          department:departments(id, name),
          position:positions(id, title)
        ),
        development_plans:development_plans(id, goal, status, progress)`,
      { count: "exact" }
    );
  const cycleId = params.get("cycle_id");
  const employeeId = params.get("employee_id");
  const minScore = params.get("min_score");
  const maxScore = params.get("max_score");
  if (cycleId) builder = builder.eq("cycle_id", cycleId);
  if (employeeId) builder = builder.eq("employee_id", employeeId);
  if (minScore) builder = builder.gte("final_score", parseFloat(minScore));
  if (maxScore) builder = builder.lte("final_score", parseFloat(maxScore));
  const { data, error, count } = await builder
    .range(pagination.from, pagination.to)
    .order("final_score", { ascending: false });
  return { rows: unwrap({ data, error }) ?? [], total: count || 0 };
}

/** Ringkasan per karyawan; nilai akhir dihitung server bila KPI & skor 360 ada. */
export async function createSummary(input: z.infer<typeof feedbackSummarySchema>) {
  await authIdentity();
  const db = createPgClient();
  let row: typeof input & { final_score?: number; final_grade?: string } = input;
  if (input.kpi_score !== undefined && input.overall_360_score !== undefined) {
    const { data: cycle } = await db
      .from("feedback_cycles")
      .select("kpi_weight, feedback_weight")
      .eq("id", input.cycle_id)
      .single();
    row = { ...input, ...computeFinalScore(input.kpi_score, input.overall_360_score, cycle) };
  }
  return unwrap(await db.from("feedback_summaries").insert(row).select().single());
}
