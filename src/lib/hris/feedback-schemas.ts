import { z } from "zod";

/**
 * Allowlist kolom modul 360 feedback (performance.feedback_*). Kolom audit
 * dan alur kerja (created_by, approved_by, approved_at, reviewed_by,
 * is_locked, locked_by, id, created_at) tidak bisa dikirim lewat body.
 */
const uuid = z.string().uuid();
const date = z.string().max(10);
const score = z.number().min(0).max(100);

export const feedbackCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    weight: z.number().min(0).max(100).optional(),
    display_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strip();

export const feedbackCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    period_label: z.string().max(50).optional(),
    start_date: date.optional(),
    end_date: date.optional(),
    status: z.string().max(30).optional(),
    kpi_weight: score.optional(),
    feedback_weight: score.optional(),
    is_anonymous: z.boolean().optional(),
    allow_self_assessment: z.boolean().optional(),
    require_manager_review: z.boolean().optional(),
  })
  .strip();

export const feedbackCycleUpdateSchema = feedbackCycleSchema.partial();

export const feedbackAssignmentSchema = z
  .object({
    cycle_id: uuid,
    employee_id: uuid,
    reviewer_id: uuid,
    relationship_type: z.string().max(30),
    due_date: date.nullable().optional(),
  })
  .strip();

export const feedbackAssignmentUpdateSchema = z
  .object({
    reviewer_id: uuid.optional(),
    relationship_type: z.string().max(30).optional(),
    // approved/rejected hanya lewat /feedback-approvals (mencatat approved_by)
    status: z.enum(["pending", "in_progress", "submitted"]).optional(),
    due_date: date.nullable().optional(),
    started_at: z.string().max(40).nullable().optional(),
    submitted_at: z.string().max(40).nullable().optional(),
  })
  .strip();

export const feedbackResponseSchema = z
  .object({
    assignment_id: uuid,
    criteria_id: uuid,
    rating: z.number().int().min(1).max(5),
    comments: z.string().max(5000).nullable().optional(),
  })
  .strip();

export const feedbackResponseUpdateSchema = feedbackResponseSchema
  .pick({ rating: true, comments: true })
  .partial();

export const feedbackSummarySchema = z
  .object({
    cycle_id: uuid,
    employee_id: uuid,
    leadership_score: score.optional(),
    communication_score: score.optional(),
    collaboration_score: score.optional(),
    accountability_score: score.optional(),
    problem_solving_score: score.optional(),
    overall_360_score: score.optional(),
    kpi_score: score.optional(),
    manager_comments: z.string().max(5000).nullable().optional(),
    strengths: z.array(z.string().max(500)).optional(),
    weaknesses: z.array(z.string().max(500)).optional(),
    burnout_risk: z.string().max(30).optional(),
    promotion_potential: z.string().max(30).optional(),
  })
  .strip();

/** Satu objek atau array objek (bulk insert), divalidasi per item. */
export function oneOrMany<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.array(schema).min(1).max(500)]);
}
