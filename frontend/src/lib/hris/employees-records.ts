import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import type {
  employeeDocumentCreateSchema,
  employeeDocumentPatchSchema,
} from "./employee-document-schema";
import { unwrap } from "./workforce-route";

/** Dokumen karyawan & riwayat kepegawaian (hris.employee_documents, hris.employment_history). */

export async function listEmployeeDocuments(employeeId: string) {
  const db = await createServerPgClient();
  const data = unwrap(
    await db
      .from("employee_documents")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
  );
  return data ?? [];
}

export async function createEmployeeDocument(input: z.infer<typeof employeeDocumentCreateSchema>) {
  const db = await createServerPgClient();
  return unwrap(
    await db
      .from("employee_documents")
      .insert({
        ...input,
        file_size_kb: input.file_size_kb ?? null,
        mime_type: input.mime_type ?? null,
        issue_date: input.issue_date ?? null,
        expiry_date: input.expiry_date ?? null,
        notes: input.notes ?? null,
      })
      .select()
      .single()
  );
}

export async function deleteEmployeeDocument(docId: string) {
  const db = await createServerPgClient();
  const { error } = await db.from("employee_documents").delete().eq("id", docId);
  unwrap({ data: null, error });
}

export async function updateEmployeeDocument(
  docId: string,
  patch: z.infer<typeof employeeDocumentPatchSchema>
) {
  const db = await createServerPgClient();
  return unwrap(
    await db
      .from("employee_documents")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", docId)
      .select()
      .single()
  );
}

export async function listEmploymentHistory(employeeId: string) {
  const db = await createServerPgClient();
  const data = unwrap(
    await db
      .from("employment_history")
      .select(
        `*,
          prev_department:departments!prev_department_id (id, name),
          new_department:departments!new_department_id (id, name),
          prev_section:sections!prev_section_id (id, name),
          new_section:sections!new_section_id (id, name),
          prev_job_title:positions!prev_job_title_id (id, title),
          new_job_title:positions!new_job_title_id (id, title)`
      )
      .eq("employee_id", employeeId)
      .order("effective_date", { ascending: false })
  );
  return data ?? [];
}

const REQUIRED_HISTORY_FIELDS = "Field wajib: employee_id, change_type, effective_date";
const requiredText = (max: number) =>
  z.string({ error: REQUIRED_HISTORY_FIELDS }).min(1, REQUIRED_HISTORY_FIELDS).max(max);
/** Kosong ("", 0, null) disimpan sebagai NULL, seperti form lama. */
const nullable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === 0 ? null : value), schema.nullable().default(null));
const optionalText = (max: number) => nullable(z.string().max(max));
const optionalAmount = nullable(z.coerce.number().nonnegative());

/** Body POST /api/hris/employment-history (promosi, mutasi, dsb.). */
export const employmentHistoryCreateSchema = z
  .object({
    employee_id: requiredText(64),
    change_type: requiredText(50),
    effective_date: requiredText(10),
    prev_department_id: optionalText(64),
    prev_section_id: optionalText(64),
    prev_job_title_id: optionalText(64),
    prev_employment_status: optionalText(50),
    prev_salary: optionalAmount,
    new_department_id: optionalText(64),
    new_section_id: optionalText(64),
    new_job_title_id: optionalText(64),
    new_employment_status: optionalText(50),
    new_salary: optionalAmount,
    reason: optionalText(2000),
    notes: optionalText(5000),
  })
  .strip();

export async function createEmploymentHistory(input: z.infer<typeof employmentHistoryCreateSchema>) {
  const db = await createServerPgClient();
  return unwrap(await db.from("employment_history").insert(input).select().single());
}
