import { z } from "zod";

export const candidateSchema = z.object({
  full_name: z.string().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  email: z.string().email("Email tidak valid"),
  phone: z.string().regex(/^[0-9+\-\s()]{10,}$/, "Nomor telepon tidak valid"),
  domicile: z.string().min(2, "Domisili minimal 2 karakter").max(100, "Domisili maksimal 100 karakter").optional(),
  source: z.enum(["portal", "internal", "referral", "jobstreet", "instagram", "jobfair", "walk_in"]),
  position_id: z.string().uuid("ID posisi tidak valid").optional(),
  brand_id: z.string().uuid("ID brand tidak valid").optional(),
  notes: z.string().max(1000, "Catatan maksimal 1000 karakter").optional(),
  cv_url: z.string().url("URL CV tidak valid").optional(),
  photo_url: z.string().url("URL foto tidak valid").optional(),
});

export const candidateFilterSchema = z.object({
  status: z.enum(["applied", "screening", "psikotes", "interview", "offer", "hired", "talent_pool", "rejected", "archived"]).optional(),
  brand_id: z.string().uuid().optional(),
  search: z.string().min(1).max(100).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const screeningSchema = z.object({
  contacted: z.boolean().default(false),
  interested: z.boolean().nullable().default(null),
  availability_note: z.string().max(200, "Ketersediaan maksimal 200 karakter").nullable().default(null),
  confirmed_salary: z
    .number()
    .int("Gaji harus bilangan bulat")
    .min(0, "Gaji tidak boleh negatif")
    .max(1_000_000_000_000, "Nominal gaji tidak wajar")
    .nullable()
    .default(null),
  willing_shift: z.boolean().nullable().default(null),
  willing_placement: z.boolean().nullable().default(null),
  notes: z.string().max(2000, "Catatan maksimal 2000 karakter").nullable().default(null),
  recommendation: z.enum(["lolos", "hold", "tidak_lolos"]).nullable().default(null),
});

export type CandidateInput = z.infer<typeof candidateSchema>;
export type CandidateFilterInput = z.infer<typeof candidateFilterSchema>;
export type ScreeningInput = z.infer<typeof screeningSchema>;
