import { z } from "zod";

/** Validasi modul Offer (EPIC-004). */

export const offerCreateSchema = z.object({
  base_salary: z.number().min(0).max(1_000_000_000_000),
  benefits: z.array(z.string().trim().min(1).max(120)).max(15).default([]),
  /** ISO date (YYYY-MM-DD) — tanggal mulai kerja yang ditawarkan. */
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  expires_days: z.number().int().min(1).max(30).default(7),
});

/** Respons kandidat via portal token. */
export const offerRespondSchema = z.object({
  action: z.enum(["accept", "negotiate", "decline"]),
  note: z.string().trim().max(2000).optional(),
});

/** Pencatatan respons manual oleh HRD (mis. kandidat membalas via WA). */
export const offerManualResponseSchema = z.object({
  status: z.enum(["negotiating", "accepted", "declined"]),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type OfferCreateInput = z.infer<typeof offerCreateSchema>;
export type OfferRespondInput = z.infer<typeof offerRespondSchema>;
export type OfferManualResponseInput = z.infer<typeof offerManualResponseSchema>;
