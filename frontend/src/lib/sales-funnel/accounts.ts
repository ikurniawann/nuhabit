/**
 * EPIC-050 Fase 1 (T-1.3) — skema Account & Contact (dipakai route + test).
 * Route Next.js hanya boleh mengekspor handler HTTP, jadi skema hidup di sini.
 */
import { z } from "zod";
import { ACCOUNT_TYPES } from "./server";

export const accountSchema = z.object({
  name: z.string().trim().min(1).max(200),
  account_type: z.enum(ACCOUNT_TYPES).default("corporate"),
  industry: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable().or(z.literal("")),
  email: z.string().trim().email().max(150).optional().nullable().or(z.literal("")),
  website: z.string().trim().max(200).optional().nullable(),
  npwp: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type AccountInput = z.infer<typeof accountSchema>;
export const updateAccountSchema = accountSchema.partial().strict();

export const contactSchema = z.object({
  account_id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(150),
  title: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(150).optional().nullable().or(z.literal("")),
  is_primary: z.boolean().default(false),
  customer_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;
export const updateContactSchema = contactSchema.partial().strict();
