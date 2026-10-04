import { z } from "zod";

/**
 * Field metadata dokumen karyawan yang BOLEH diubah manual lewat PATCH.
 * Sengaja allowlist (bukan spread body mentah) — kolom verifikasi
 * (is_verified/verified_by/verified_at), kepemilikan (employee_id), dan
 * uploader tidak boleh dipaksa lewat body (audit 2026-09-17).
 */
export const employeeDocumentPatchSchema = z
  .object({
    document_type: z.string().max(120).optional(),
    document_name: z.string().max(255).optional(),
    issue_date: z.string().optional().nullable(),
    expiry_date: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strip();

const REQUIRED_DOCUMENT_FIELDS = "Field wajib: employee_id, document_type, document_name, file_url";
const required = (max: number) =>
  z.string({ error: REQUIRED_DOCUMENT_FIELDS }).min(1, REQUIRED_DOCUMENT_FIELDS).max(max);
/** String kosong dari form = tidak diisi (kolom opsional jadi NULL). */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === 0 ? undefined : value), schema.optional().nullable());

/** Body POST /api/hris/employees/documents (record setelah file diunggah). */
export const employeeDocumentCreateSchema = z
  .object({
    employee_id: required(64),
    document_type: required(120),
    document_name: required(255),
    file_url: required(1000),
    file_size_kb: optional(z.number().nonnegative()),
    mime_type: optional(z.string().max(120)),
    issue_date: optional(z.string().max(10)),
    expiry_date: optional(z.string().max(10)),
    notes: optional(z.string().max(2000)),
  })
  .strip();
