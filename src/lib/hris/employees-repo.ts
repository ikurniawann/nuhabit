import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import type { Employee } from "@/types/hris";
import { employeeUpdateSchema, type EmployeeUpdateInput } from "./employee-update-schema";
import { unwrap, unwrapSingle } from "./workforce-route";

/**
 * Direktori & record karyawan (hris.employees) lewat query builder pg.
 * Daftar direktori sengaja tanpa kolom pribadi (KTP, NPWP, rekening, BPJS,
 * alamat, kontak darurat); record lengkap hanya lewat getEmployee.
 */

const DIRECTORY_COLUMNS = `id, user_id, full_name, nip, email, phone, photo_url,
  join_date, end_date, employment_status, is_active, is_access_app,
  department_id, section_id, job_title_id, reporting_to, created_at, updated_at`;

const SORTABLE = new Set(["full_name", "nip", "email", "join_date", "employment_status", "created_at"]);
const MAX_LIMIT = 500;

export interface DirectoryParams {
  search: string | null;
  departmentId: string | null;
  sectionId: string | null;
  employmentStatus: string | null;
  isActive: boolean | null;
  page: number;
  limit: number;
  sortBy: string;
  ascending: boolean;
}

export function parseDirectoryParams(params: URLSearchParams): DirectoryParams {
  // Koma/kurung memecah ekspresi .or(), jadi dibuang supaya search tidak
  // bisa menyisipkan filter ke kolom lain.
  const search = params.get("search")?.replace(/[,()]/g, " ").trim() || null;
  const requestedSort = params.get("sort_by") || "full_name";
  const isActive = params.get("is_active");
  return {
    search,
    departmentId: params.get("department_id"),
    sectionId: params.get("section_id"),
    employmentStatus: params.get("employment_status"),
    isActive: isActive === null ? null : isActive === "true",
    page: Math.max(1, parseInt(params.get("page") || "1") || 1),
    limit: Math.min(MAX_LIMIT, Math.max(1, parseInt(params.get("limit") || "20") || 20)),
    sortBy: SORTABLE.has(requestedSort) ? requestedSort : "full_name",
    ascending: (params.get("sort_order") || "asc") === "asc",
  };
}

export async function listEmployeeDirectory(params: DirectoryParams) {
  const db = createPgClient();
  let query = db.from("employees").select(
    `${DIRECTORY_COLUMNS},
      department:departments (id, name, code),
      section:sections (id, name, code),
      job_title:positions (id, title, department),
      manager:employees!reporting_to (id, full_name, nip)`,
    { count: "exact" }
  );

  if (params.search) {
    const s = params.search;
    query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,nip.ilike.%${s}%`);
  }
  if (params.departmentId) query = query.eq("department_id", params.departmentId);
  if (params.sectionId) query = query.eq("section_id", params.sectionId);
  if (params.employmentStatus) query = query.eq("employment_status", params.employmentStatus);
  if (params.isActive !== null) query = query.eq("is_active", params.isActive);

  const from = (params.page - 1) * params.limit;
  const result = await query
    .order(params.sortBy, { ascending: params.ascending })
    .range(from, from + params.limit - 1);
  return { data: (unwrap(result) ?? []) as Employee[], total: result.count || 0 };
}

const REQUIRED_MESSAGE =
  "Field yang wajib diisi: nama lengkap, email, tanggal bergabung, status karyawan";

/** Field create = allowlist update (tanpa status aktif/end_date) + empat field wajib. */
export const employeeCreateSchema = employeeUpdateSchema.omit({ is_active: true, end_date: true }).extend({
  full_name: z.string({ error: REQUIRED_MESSAGE }).trim().min(1, REQUIRED_MESSAGE).max(255),
  email: z.string({ error: REQUIRED_MESSAGE }).min(1, REQUIRED_MESSAGE).email().max(255),
  join_date: z.string({ error: REQUIRED_MESSAGE }).min(1, REQUIRED_MESSAGE).max(10),
  employment_status: z.string({ error: REQUIRED_MESSAGE }).min(1, REQUIRED_MESSAGE).max(50),
});

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

/** NIP otomatis "EMP-<tahun>-<5 digit>": nomor urut terkecil yang belum dipakai. */
export function nextAutoNip(year: number, taken: readonly string[]): string {
  const used = new Set(taken);
  for (let seq = 1; seq <= 99999; seq += 1) {
    const nip = `EMP-${year}-${String(seq).padStart(5, "0")}`;
    if (!used.has(nip)) return nip;
  }
  throw ApiError.server("Tidak dapat generate NIP unik");
}

async function existsWhere(column: "nip" | "email", value: string, excludeId?: string) {
  let query = createPgClient().from("employees").select("id").eq(column, value);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.single();
  return Boolean(data);
}

const EMPLOYEE_WITH_REFS = `*,
  department:departments (id, name, code),
  section:sections (id, name),
  job_title:positions (id, title),
  manager:employees!reporting_to (id, full_name, nip)`;

/** Pesan ramah untuk bentrok unique saat insert karyawan. */
export function employeeUniqueMessage(message: string | undefined): string | null {
  if (message?.includes("nip")) return "NIP sudah digunakan, silakan coba lagi atau gunakan NIP lain";
  if (message?.includes("email")) return "Email sudah terdaftar";
  if (message?.includes("ktp")) return "NIK/KTP sudah terdaftar";
  return null;
}

export async function createEmployee(input: EmployeeCreateInput): Promise<Employee> {
  const db = createPgClient();
  let nip = input.nip?.trim() ?? "";
  if (nip) {
    if (await existsWhere("nip", nip)) throw ApiError.badRequest("NIP sudah digunakan");
  } else {
    const year = new Date().getFullYear();
    const { data: taken } = await db.from("employees").select("nip").like("nip", `EMP-${year}-%`);
    nip = nextAutoNip(year, ((taken ?? []) as { nip: string }[]).map((row) => row.nip));
  }
  if (await existsWhere("email", input.email)) throw ApiError.badRequest("Email sudah digunakan");

  const { data, error } = await db
    .from("employees")
    .insert({ ...input, nip, phone: input.phone || "" })
    .select(EMPLOYEE_WITH_REFS)
    .single();
  if (error?.code === "23505") {
    const friendly = employeeUniqueMessage(error.message);
    if (friendly) throw ApiError.badRequest(friendly);
  }
  return unwrap({ data, error }) as Employee;
}

async function loadManager(reportingTo: string | null | undefined) {
  if (!reportingTo) return null;
  const { data } = await createPgClient()
    .from("employees")
    .select("id, full_name, nip")
    .eq("id", reportingTo)
    .single();
  return data ?? null;
}

export async function getEmployee(id: string): Promise<Employee> {
  const employee = unwrapSingle(
    await createPgClient()
      .from("employees")
      .select(
        `*,
          department:departments (id, name, code, description),
          section:sections (id, name, code, color),
          job_title:positions (id, title, department, level),
          direct_reports:employees!reporting_to (id, full_name, nip)`
      )
      .eq("id", id)
      .single(),
    "Karyawan tidak ditemukan"
  );
  // manager dimuat terpisah agar join self-reference tidak ambigu
  return { ...employee, manager: await loadManager(employee.reporting_to) } as Employee;
}

type TrackedKey = "employment_status" | "department_id" | "section_id" | "job_title_id";
type TrackedState = Record<TrackedKey, string | null>;

const TRACKED_LABELS: Record<Exclude<TrackedKey, "employment_status">, string> = {
  department_id: "Departemen berubah",
  section_id: "Seksi berubah",
  job_title_id: "Jabatan berubah",
};

/**
 * Riwayat kepegawaian dari PUT. Hanya field yang dikirim yang dibandingkan:
 * PUT parsial tidak boleh tercatat sebagai perubahan departemen/jabatan.
 */
export function employmentHistoryChange(current: TrackedState, body: EmployeeUpdateInput) {
  const after = (key: TrackedKey) => (key in body ? (body[key] ?? null) : current[key]);
  const notes: string[] = [];
  if (current.employment_status !== after("employment_status")) {
    notes.push(`Status: ${current.employment_status} → ${after("employment_status")}`);
  }
  for (const key of Object.keys(TRACKED_LABELS) as (keyof typeof TRACKED_LABELS)[]) {
    if (current[key] !== after(key)) notes.push(TRACKED_LABELS[key]);
  }
  if (notes.length === 0) return null;
  return {
    change_type: "status_change",
    notes: notes.join(", "),
    prev_employment_status: current.employment_status,
    new_employment_status: after("employment_status"),
    prev_department_id: current.department_id,
    new_department_id: after("department_id"),
    prev_section_id: current.section_id,
    new_section_id: after("section_id"),
    prev_job_title_id: current.job_title_id,
    new_job_title_id: after("job_title_id"),
  };
}

export async function updateEmployee(id: string, body: EmployeeUpdateInput): Promise<Employee> {
  const db = createPgClient();
  const { data: current } = await db
    .from("employees")
    .select("employment_status, department_id, section_id, job_title_id")
    .eq("id", id)
    .single();
  if (!current) throw ApiError.notFound("Karyawan tidak ditemukan");

  if (body.email && (await existsWhere("email", body.email, id))) {
    throw ApiError.badRequest("Email sudah digunakan");
  }
  if (body.nip && (await existsWhere("nip", body.nip, id))) {
    throw ApiError.badRequest("NIP sudah digunakan");
  }

  // phone NOT NULL: kosongkan jadi '' bila dikirim null
  const { data, error } = await db
    .from("employees")
    .update({
      ...body,
      ...("phone" in body ? { phone: body.phone || "" } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, department:departments(id, name, code), section:sections(id, name), job_title:positions(id, title)")
    .single();
  const updated = unwrap({ data, error });

  const change = employmentHistoryChange(current as TrackedState, body);
  if (change) {
    const { error: historyError } = await db.from("employment_history").insert({
      employee_id: id,
      ...change,
      effective_date: new Date().toISOString().split("T")[0],
    });
    // riwayat pelengkap: kegagalan dicatat, update karyawan tetap sukses
    if (historyError) console.error("[employees] employment history insert failed:", historyError);
  }

  return { ...updated, manager: await loadManager(updated?.reporting_to) } as Employee;
}

/** Soft delete: is_active=false + end_date hari ini. */
export async function deactivateEmployee(id: string): Promise<Employee> {
  const db = createPgClient();
  const { data: existing } = await db.from("employees").select("id").eq("id", id).single();
  if (!existing) throw ApiError.notFound("Karyawan tidak ditemukan");

  const now = new Date().toISOString();
  const result = await db
    .from("employees")
    .update({ is_active: false, end_date: now.split("T")[0], updated_at: now })
    .eq("id", id)
    .select("id, full_name, nip, is_active")
    .single();
  return unwrap(result) as Employee;
}
