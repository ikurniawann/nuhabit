/**
 * Form lowongan halaman Job Portal (dashboard HR): tipe data, nilai awal,
 * isian otomatis dari master posisi, dan payload simpan. Murni, aman di klien.
 */

export type JobStatus = "draft" | "published" | "closed";

export interface JobPositionOption {
  id: string;
  title: string;
  department: string | null;
  level: string | null;
}

export interface JobDepartmentOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface JobOpening {
  id: string;
  position_id: string | null;
  brand_id: string | null;
  department_id: string | null;
  title: string;
  slug: string;
  department: string;
  location: string;
  employment_type: string;
  work_mode: string;
  headcount: number;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  status: JobStatus;
  closing_date: string | null;
  created_at: string;
  updated_at: string;
  brand?: { id: string; name: string } | null;
  position?: JobPositionOption | null;
  department_ref?: Pick<JobDepartmentOption, "id" | "name" | "code"> | null;
}

/** Nilai form: kolom nullable jadi "" supaya bisa diikat ke input. */
export interface JobForm {
  id?: string;
  position_id: string;
  brand_id: string;
  department_id: string;
  title: string;
  slug: string;
  department: string;
  location: string;
  employment_type: string;
  work_mode: string;
  headcount: number;
  description: string;
  requirements: string;
  benefits: string;
  status: JobStatus;
  closing_date: string;
}

export type JobOpeningPayload = Omit<
  JobForm,
  "id" | "position_id" | "brand_id" | "department_id" | "closing_date"
> & {
  position_id: string | null;
  brand_id: string | null;
  department_id: string | null;
  closing_date: string | null;
};

export const EMPTY_JOB_FORM: JobForm = {
  position_id: "",
  brand_id: "",
  department_id: "",
  title: "",
  slug: "",
  department: "Operations",
  location: "Jakarta, ID",
  employment_type: "Full-time",
  work_mode: "On-site",
  headcount: 1,
  description: "",
  requirements: "",
  benefits: "",
  status: "draft",
  closing_date: "",
};

/** Slug lowongan; dipakai form klien dan normalisasi server (lib/hris/job-openings.ts). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function jobToForm(job: JobOpening): JobForm {
  return {
    id: job.id,
    position_id: job.position_id || "",
    brand_id: job.brand_id || "",
    department_id: job.department_id || "",
    title: job.title,
    slug: job.slug,
    department: job.department,
    location: job.location,
    employment_type: job.employment_type,
    work_mode: job.work_mode,
    headcount: job.headcount,
    description: job.description || "",
    requirements: job.requirements || "",
    benefits: job.benefits || "",
    status: job.status,
    closing_date: job.closing_date || "",
  };
}

/** Judul baru mengisi slug hanya bila slug masih kosong. */
export const withTitle = (form: JobForm, title: string): JobForm => ({
  ...form,
  title,
  slug: form.slug || slugify(title),
});

/**
 * Pilih master posisi: judul & slug terisi bila masih kosong, department
 * dicocokkan berdasarkan nama (tanpa beda huruf besar/kecil).
 */
export function withPosition(
  form: JobForm,
  positionId: string,
  positions: JobPositionOption[],
  departments: JobDepartmentOption[]
): JobForm {
  const position = positions.find((item) => item.id === positionId);
  const matched = departments.find(
    (department) => department.name.toLowerCase() === (position?.department || "").toLowerCase()
  );
  return {
    ...form,
    position_id: positionId,
    title: form.title || position?.title || "",
    slug: form.slug || slugify(position?.title || ""),
    department_id: matched?.id || form.department_id,
    department: matched?.name || form.department || position?.department || "Operations",
  };
}

export function withDepartment(form: JobForm, departmentId: string, departments: JobDepartmentOption[]): JobForm {
  return {
    ...form,
    department_id: departmentId,
    department: departments.find((item) => item.id === departmentId)?.name || "",
  };
}

/** Form → payload API: string kosong jadi null, slug jatuh ke judul. */
export function toJobPayload({ id, ...form }: JobForm): { id?: string; payload: JobOpeningPayload } {
  return {
    id,
    payload: {
      ...form,
      slug: form.slug || slugify(form.title),
      position_id: form.position_id || null,
      brand_id: form.brand_id || null,
      department_id: form.department_id || null,
      closing_date: form.closing_date || null,
    },
  };
}

export function countJobsByStatus(jobs: Pick<JobOpening, "status">[]): Record<JobStatus, number> {
  const counts: Record<JobStatus, number> = { draft: 0, published: 0, closed: 0 };
  for (const job of jobs) if (job.status in counts) counts[job.status] += 1;
  return counts;
}
