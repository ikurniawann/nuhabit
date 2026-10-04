import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import { isUuid } from "./candidate-query";

/**
 * Form karir publik (/portal → /api/portal/submit) dan opsi dropdown-nya.
 * Semua input berasal dari pelamar anonim: validasi ketat, berkas dicek
 * tipe & ukuran sebelum diunggah.
 */

const REQUIRED = "Field wajib belum lengkap";
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CV_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const requiredText = z.string({ error: REQUIRED }).min(1, REQUIRED);
const optionalText = z
  .string()
  .nullish()
  .transform((v) => v || null);

const applicationSchema = z.object({
  full_name: requiredText,
  email: requiredText.pipe(z.string().max(255, "Format email tidak valid").regex(EMAIL_RE, "Format email tidak valid")),
  phone: requiredText,
  domicile: requiredText,
  source: requiredText,
  position_id: optionalText,
  brand_id: optionalText,
  job_opening_id: optionalText,
  notes: optionalText,
  last_experience: optionalText,
  last_education: optionalText,
  availability: optionalText,
  expected_salary: optionalText.transform((v) => {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

/** Field teks form → input tervalidasi. "Field wajib" didahulukan dari galat format. */
export function parseApplicationFields(form: FormData): ApplicationInput {
  const raw = Object.fromEntries(
    Object.keys(applicationSchema.shape).map((key) => {
      const value = form.get(key);
      return [key, typeof value === "string" ? value : undefined];
    })
  );
  const parsed = applicationSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const messages = parsed.error.issues.map((i) => i.message);
  throw ApiError.badRequest(messages.includes(REQUIRED) ? REQUIRED : (messages[0] ?? REQUIRED));
}

function fileField(form: FormData, key: string): File | null {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

async function uploadChecked(
  file: File,
  rule: { types: string[]; typeError: string; sizeError: string; bucket: string; uploadError: string }
) {
  if (!rule.types.includes(file.type)) throw ApiError.badRequest(rule.typeError);
  if (file.size > MAX_FILE_BYTES) throw ApiError.badRequest(rule.sizeError);
  const result = await uploadFile(rule.bucket, file, "candidates");
  if (result.error) throw new ApiError(500, `${rule.uploadError}: ${result.error}`);
  return result.url;
}

/** Pas foto wajib, CV opsional (PDF/DOC); keduanya maks 2MB. */
export async function uploadApplicationFiles(form: FormData) {
  const photo = fileField(form, "photo");
  if (!photo) throw ApiError.badRequest("Pas foto wajib diupload");
  const cv = fileField(form, "cv");
  const cvUrl = cv
    ? await uploadChecked(cv, {
        types: CV_MIME_TYPES,
        typeError: "CV harus format PDF atau DOC",
        sizeError: "CV maksimal 2MB",
        bucket: "cv",
        uploadError: "Gagal upload CV",
      })
    : null;
  const photoUrl = await uploadChecked(photo, {
    types: PHOTO_MIME_TYPES,
    typeError: "Foto harus format JPG/PNG",
    sizeError: "Foto maksimal 2MB",
    bucket: "photos",
    uploadError: "Gagal upload foto",
  });
  return { cvUrl, photoUrl };
}

/** Simpan lamaran sbg kandidat baru (status applied) + nama posisi/outlet utk email. */
export async function createPortalApplication(
  input: ApplicationInput,
  files: { cvUrl: string | null; photoUrl: string | null }
) {
  const [position, brand] = await Promise.all([
    input.position_id && isUuid(input.position_id)
      ? queryOne<{ title: string }>("SELECT title FROM hris.positions WHERE id = $1", [input.position_id])
      : null,
    input.brand_id && isUuid(input.brand_id)
      ? queryOne<{ name: string }>("SELECT name FROM item.brands WHERE id = $1", [input.brand_id])
      : null,
  ]);

  const candidate = await queryOne<{ id: string }>(
    `INSERT INTO recruitment.candidates
       (full_name, email, phone, domicile, source, position_id, brand_id, job_opening_id,
        cv_url, photo_url, notes, status, last_experience, last_education, availability, expected_salary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'applied', $12, $13, $14, $15)
     RETURNING id`,
    [
      input.full_name,
      input.email,
      input.phone,
      input.domicile,
      input.source,
      input.position_id,
      input.brand_id,
      input.job_opening_id,
      files.cvUrl,
      files.photoUrl,
      input.notes,
      input.last_experience,
      input.last_education,
      input.availability,
      input.expected_salary,
    ]
  );
  if (!candidate) throw new ApiError(500, "Gagal simpan lamaran");
  return {
    candidateId: candidate.id,
    positionTitle: position?.title ?? "Belum ditentukan",
    brandName: brand?.name ?? "Umum",
  };
}

/**
 * Opsi form karir: outlet aktif (item.brands, mirror level Branch), posisi
 * aktif, dan brand/posisi job opening utk auto-fill. Hanya data yang memang
 * tampil publik.
 */
export async function getPortalOptions(openingId: string | null) {
  const [outlets, positions, opening] = await Promise.all([
    query<{ id: string; name: string }>("SELECT id, name FROM item.brands WHERE is_active = true ORDER BY name"),
    query<{ id: string; title: string; brand_id: string | null }>(
      "SELECT id, title, brand_id FROM hris.positions WHERE is_active = true ORDER BY title"
    ),
    openingId && isUuid(openingId)
      ? queryOne<{ brand_id: string | null; position_id: string | null }>(
          "SELECT brand_id, position_id FROM recruitment.job_openings WHERE id = $1",
          [openingId]
        )
      : null,
  ]);
  return { outlets, positions, opening };
}
