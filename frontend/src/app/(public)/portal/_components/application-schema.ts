import { z } from "zod";

/** Client-side validation for the public application form (the server validates again). */
export const applicationFormSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters").max(100, "Name must be 100 characters or fewer"),
  email: z.string().email("Enter a valid email address"),
  phone: z
    .string()
    .min(9, "Number is too short")
    .regex(/^(\+62|62|0)[0-9]{9,12}$/, "Enter a valid WhatsApp number (example: 081234567890)"),
  domicile: z.string().min(2, "City of residence is required").max(100, "100 characters or fewer"),
  source: z.enum(["portal", "instagram", "jobstreet", "referral", "walk_in", "other"]),
  position_id: z.string().optional(),
  brand_id: z.string().optional(),
  notes: z.string().max(1000, "Notes must be 1000 characters or fewer").optional(),
  last_experience: z.string().max(200, "200 characters or fewer").optional(),
  last_education: z.string().max(200, "200 characters or fewer").optional(),
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

/** Multipart payload for POST /api/portal/submit; empty optional fields are left out. */
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
