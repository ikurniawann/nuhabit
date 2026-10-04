import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import type { ContractType } from "./contracts";
import { createDraftContract } from "./create-contract";

/** Tab profil karyawan: lifecycle, dokumen rekrutmen, kontrak; plus selektor departemen. */

export async function listDepartments() {
  return query<{ id: string; name: string; code: string | null; parent_department_id: string | null }>(
    `SELECT id, name, code, parent_department_id
     FROM hris.departments
     ORDER BY name ASC`
  );
}

const REPORT_STAGES = new Set(["offer", "hired"]);

/** CV & ketersediaan Laporan Pipeline dari kandidat yang dipromosikan. */
export async function loadRecruitmentDocuments(employeeId: string) {
  const candidate = await queryOne<{
    id: string;
    cv_url: string | null;
    status: string;
    created_at: string;
    position_title: string | null;
  }>(
    `SELECT c.id, c.cv_url, c.status, c.created_at, p.title AS position_title
     FROM recruitment.candidates c
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE c.promoted_to_employee_id = $1
     ORDER BY c.created_at DESC LIMIT 1`,
    [employeeId]
  );
  if (!candidate) return null;
  return {
    candidate_id: candidate.id,
    cv_url: candidate.cv_url,
    status: candidate.status,
    applied_at: candidate.created_at,
    position_title: candidate.position_title,
    report_available: REPORT_STAGES.has(candidate.status),
  };
}

/**
 * Perjalanan hidup karyawan: rekrutmen (kandidat yang dipromosikan) → join →
 * onboarding → akun aplikasi → riwayat kepegawaian → offboarding → berakhir.
 */
export async function loadEmployeeLifecycle(employeeId: string) {
  const employee = await queryOne<{
    id: string;
    full_name: string;
    user_id: string | null;
    join_date: string | null;
    end_date: string | null;
    employment_status: string;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, full_name, user_id, join_date, end_date, employment_status,
            is_active, created_at
     FROM hris.employees WHERE id = $1`,
    [employeeId]
  );
  if (!employee) throw ApiError.notFound("Karyawan tidak ditemukan");

  const [candidate, accountUser, onboarding, history, offboarding] = await Promise.all([
    queryOne<{
      id: string;
      created_at: string;
      promotion_date: string | null;
      source: string | null;
      position_title: string | null;
      offer_accepted_at: string | null;
    }>(
      `SELECT c.id, c.created_at, c.promotion_date, c.source,
              p.title AS position_title,
              (SELECT o.responded_at FROM recruitment.candidate_offers o
               WHERE o.candidate_id = c.id AND o.status = 'accepted'
               ORDER BY o.responded_at DESC LIMIT 1) AS offer_accepted_at
       FROM recruitment.candidates c
       LEFT JOIN hris.positions p ON p.id = c.position_id
       WHERE c.promoted_to_employee_id = $1
       ORDER BY c.created_at DESC LIMIT 1`,
      [employeeId]
    ),
    employee.user_id
      ? queryOne<{ email: string; created_at: string; last_sign_in_at: string | null }>(
          `SELECT email, created_at, last_sign_in_at FROM auth.users WHERE id = $1`,
          [employee.user_id]
        )
      : Promise.resolve(null),
    queryOne<{ total: number; completed: number; last_completed_at: string | null }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE completed)::int AS completed,
              max(completed_at) AS last_completed_at
       FROM hris.onboarding_checklists WHERE employee_id = $1`,
      [employeeId]
    ),
    query(
      `SELECT h.id, h.change_type, h.effective_date, h.reason, h.notes,
              h.prev_employment_status, h.new_employment_status,
              pd.name AS prev_department_name, nd.name AS new_department_name,
              pj.title AS prev_job_title, nj.title AS new_job_title
       FROM hris.employment_history h
       LEFT JOIN hris.departments pd ON pd.id = h.prev_department_id
       LEFT JOIN hris.departments nd ON nd.id = h.new_department_id
       LEFT JOIN hris.positions pj ON pj.id = h.prev_job_title_id
       LEFT JOIN hris.positions nj ON nj.id = h.new_job_title_id
       WHERE h.employee_id = $1
       ORDER BY h.effective_date, h.created_at`,
      [employeeId]
    ),
    queryOne<{
      id: string;
      status: string;
      resignation_type: string | null;
      resignation_date: string | null;
      last_working_day: string | null;
      clearance_hrd: boolean | null;
      clearance_it: boolean | null;
      clearance_finance: boolean | null;
      clearance_manager: boolean | null;
      completed_at: string | null;
    }>(
      `SELECT id, status, resignation_type, resignation_date, last_working_day,
              clearance_hrd, clearance_it, clearance_finance, clearance_manager,
              completed_at
       FROM hris.offboarding_checklists WHERE employee_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [employeeId]
    ),
  ]);

  return {
    employee: {
      join_date: employee.join_date,
      end_date: employee.end_date,
      employment_status: employee.employment_status,
      is_active: employee.is_active,
      created_at: employee.created_at,
      has_account: Boolean(employee.user_id),
    },
    recruitment: candidate
      ? {
          candidate_id: candidate.id,
          applied_at: candidate.created_at,
          source: candidate.source,
          position_title: candidate.position_title,
          offer_accepted_at: candidate.offer_accepted_at,
          promoted_at: candidate.promotion_date,
        }
      : null,
    account: accountUser
      ? {
          email: accountUser.email,
          created_at: accountUser.created_at,
          last_sign_in_at: accountUser.last_sign_in_at,
        }
      : null,
    onboarding: onboarding ?? { total: 0, completed: 0, last_completed_at: null },
    history,
    offboarding: offboarding ?? null,
  };
}

export interface EmployeeContractRow {
  id: string;
  employee_id: string;
  contract_number: string;
  contract_type: ContractType;
  status: string;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  parent_contract_id: string | null;
  sequence: number;
  position_title: string | null;
  department_name: string | null;
  work_location: string | null;
  base_salary: string | null;
  allowances: unknown;
  signed_at: string | null;
  signed_document_url: string | null;
  kemnaker_registered_at: string | null;
  compensation_amount: string | null;
  compensation_paid_at: string | null;
  terminated_reason: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

export async function listEmployeeContracts(employeeId: string) {
  return query<EmployeeContractRow>(
    `SELECT * FROM hris.employment_contracts
     WHERE employee_id = $1
     ORDER BY created_at DESC`,
    [employeeId]
  );
}

const optionalText = (max: number) => z.string().max(max).nullable().optional();

/** Body POST /api/hris/employees/[id]/contracts (draft PKWTT/PKWT). */
export const createContractSchema = z.object({
  contract_type: z.enum(["pkwt", "pkwtt"], { error: "Tipe kontrak harus 'pkwt' atau 'pkwtt'" }),
  start_date: z
    .string({ error: "Tanggal mulai wajib diisi" })
    .min(1, "Tanggal mulai wajib diisi")
    .max(10),
  end_date: optionalText(10),
  probation_end_date: optionalText(10),
  parent_contract_id: z.guid().nullable().optional(),
  position_title: optionalText(255),
  department_name: optionalText(255),
  work_location: optionalText(255),
  base_salary: z.number().nonnegative().nullable().optional(),
  notes: optionalText(5000),
});

/**
 * Buat draft kontrak; validasi compliance (batas PKWT 5 tahun, larangan
 * probation PKWT, probation PKWTT ≤ 3 bulan) ditegakkan createDraftContract.
 */
export async function createEmployeeContract(
  employeeId: string,
  body: z.infer<typeof createContractSchema>,
  createdByName: string
) {
  const result = await createDraftContract({
    employeeId,
    contractType: body.contract_type,
    startDate: body.start_date,
    endDate: body.end_date ?? null,
    probationEndDate: body.probation_end_date ?? null,
    parentContractId: body.parent_contract_id ?? null,
    positionTitle: body.position_title ?? null,
    departmentName: body.department_name ?? null,
    workLocation: body.work_location ?? null,
    baseSalary: body.base_salary ?? null,
    notes: body.notes ?? null,
    createdByName,
  });
  if (!result.ok) throw new ApiError(result.status, result.error);

  const created = await queryOne<EmployeeContractRow>(
    `SELECT * FROM hris.employment_contracts WHERE id = $1`,
    [result.contract.id]
  );
  return { contract: created, contractNumber: result.contract.contract_number };
}
