/** Skema payload API jadwal gym (dipakai route staf). */
import { z } from "zod";

export const classTypeSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).default(""),
  default_duration_min: z.number().int().min(15).max(240),
  default_credit_cost: z.number().int().min(1).max(20),
  default_capacity: z.number().int().min(1).max(200),
  color: z.enum(["lime", "info", "warning", "danger", "success", "ink"]).default("lime"),
  status: z.enum(["active", "archived"]).default("active"),
});

export const coachSchema = z.object({
  name: z.string().trim().min(3).max(80),
  bio: z.string().trim().max(1000).default(""),
  specialization: z.string().trim().max(120).default(""),
  photo_url: z.string().trim().url().max(500).nullable().default(null),
  user_id: z.string().uuid().nullable().default(null),
  branch_id: z.string().uuid().nullable().default(null),
  status: z.enum(["active", "inactive"]).default("active"),
});

const startsAt = z.string().datetime({ offset: true }).transform((v) => new Date(v));

export const sessionCreateSchema = z.object({
  class_type_id: z.string().uuid(),
  coach_id: z.string().uuid().nullable().default(null),
  branch_id: z.string().uuid().nullable().default(null),
  area: z.string().trim().max(80).nullable().default(null),
  starts_at: startsAt,
  duration_min: z.number().int().min(15).max(240).nullable().optional(),
  capacity: z.number().int().min(1).max(200).nullable().optional(),
  credit_cost: z.number().int().min(1).max(20).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  publish: z.boolean().default(true),
});

export const sessionPatchSchema = z.object({
  coach_id: z.string().uuid().nullable().optional(),
  area: z.string().trim().max(80).nullable().optional(),
  starts_at: startsAt.optional(),
  duration_min: z.number().int().min(15).max(240).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const weekStart = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
