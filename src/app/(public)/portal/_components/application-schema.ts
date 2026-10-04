import { z } from "zod";

/** Validasi sisi klien form lamaran publik (server memvalidasi ulang). */
export const applicationFormSchema = z.object({
  full_name: z.string().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  email: z.string().email("Format email tidak valid"),
  phone: z
    .string()
    .min(9, "Nomor terlalu pendek")
    .regex(/^(\+62|62|0)[0-9]{9,12}$/, "Format nomor WA tidak valid (contoh: 081234567890)"),
  domicile: z.string().min(2, "Domisili harus diisi").max(100, "Maksimal 100 karakter"),
  source: z.enum(["portal", "instagram", "jobstreet", "referral", "walk_in", "other"]),
  position_id: z.string().optional(),
  brand_id: z.string().optional(),
  notes: z.string().max(1000, "Catatan maksimal 1000 karakter").optional(),
  last_experience: z.string().max(200, "Maksimal 200 karakter").optional(),
  last_education: z.string().max(200, "Maksimal 200 karakter").optional(),
  availability: z.enum(["immediate", "1_week", "2_weeks", "1_month"]).optional(),
  expected_salary: z.string().optional(),
});

export type ApplicationFormValues = z.infer<typeof applicationFormSchema>;

const OPTIONAL_FIELDS = [
  "position_id",
  "brand_id",
  "notes",
  "last_experience",
  "last_education",
  "availability",
  "expected_salary",
] as const;

/** Payload multipart untuk POST /api/portal/submit; field opsional kosong tidak dikirim. */
export function toSubmitFormData(
  values: ApplicationFormValues,
  extra: { jobOpeningId: string | null; cv: File | null; photo: File | null }
): FormData {
  const form = new FormData();
  form.append("full_name", values.full_name);
  form.append("email", values.email);
  form.append("phone", values.phone);
  form.append("domicile", values.domicile);
  form.append("source", values.source);
  for (const key of OPTIONAL_FIELDS) {
    const value = values[key];
    if (value) form.append(key, value);
  }
  if (extra.jobOpeningId) form.append("job_opening_id", extra.jobOpeningId);
  if (extra.cv) form.append("cv", extra.cv);
  if (extra.photo) form.append("photo", extra.photo);
  return form;
}
