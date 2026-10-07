import { query, queryOne } from "@/lib/db";
import {
  monthsWorked,
  pkwtChainTotalMonths,
  validateContractDates,
  validatePkwtTotal,
  type ContractType,
} from "./contracts";
import { withContractNumber } from "./contract-number";

/**
 * Pembuatan draft kontrak server-side — dipakai route POST kontrak dan
 * auto-draft saat promote kandidat → karyawan (Fase D). Menjalankan seluruh
 * validasi compliance (tanggal, larangan probation PKWT, batas rantai PKWT
 * 5 tahun) lalu insert dengan nomor kontrak berurut.
 */

export interface CreateDraftContractInput {
  employeeId: string;
  contractType: ContractType;
  startDate: string;
  endDate?: string | null;
  probationEndDate?: string | null;
  parentContractId?: string | null;
  positionTitle?: string | null;
  departmentName?: string | null;
  workLocation?: string | null;
  baseSalary?: number | string | null;
  notes?: string | null;
  createdByName?: string | null;
}

export type CreateDraftContractResult =
  | { ok: true; contract: { id: string; contract_number: string } }
  | { ok: false; status: 400 | 404 | 422; error: string };

export async function createDraftContract(
  input: CreateDraftContractInput
): Promise<CreateDraftContractResult> {
  const dateErrors = validateContractDates({
    contract_type: input.contractType,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    probation_end_date: input.probationEndDate ?? null,
  });
  if (dateErrors.length > 0) {
    return { ok: false, status: 400, error: dateErrors.join(" ") };
  }

  // Snapshot default dari data karyawan + gaji aktif bila tidak diisi manual
  const employee = await queryOne<{
    id: string;
    position_title: string | null;
    department_name: string | null;
    base_salary: string | null;
  }>(
    `SELECT e.id, p.title AS position_title, d.name AS department_name, s.base_salary
     FROM hris.employees e
     LEFT JOIN hris.positions p ON p.id = e.job_title_id
     LEFT JOIN hris.departments d ON d.id = e.department_id
     LEFT JOIN LATERAL (
       SELECT base_salary FROM hris.employee_salary
       WHERE employee_id = e.id AND is_active
       ORDER BY effective_date DESC LIMIT 1
     ) s ON true
     WHERE e.id = $1`,
    [input.employeeId]
  );
  if (!employee) {
    return { ok: false, status: 404, error: "Karyawan tidak ditemukan" };
  }

  // Batas total PKWT 5 tahun — jumlahkan seluruh kontrak PKWT non-draft
  let sequence = 1;
  if (input.contractType === "pkwt") {
    const chain = await query<{ start_date: string; end_date: string | null }>(
      `SELECT start_date, end_date FROM hris.employment_contracts
       WHERE employee_id = $1 AND contract_type = 'pkwt' AND status <> 'draft'`,
      [input.employeeId]
    );
    const totalError = validatePkwtTotal(
      pkwtChainTotalMonths(chain),
      monthsWorked(input.startDate, input.endDate ?? input.startDate)
    );
    if (totalError) {
      return { ok: false, status: 422, error: totalError };
    }
    sequence = chain.length + 1;
  }

  const contract = await withContractNumber(input.contractType, (contractNumber) =>
    queryOne<{ id: string; contract_number: string }>(
      `INSERT INTO hris.employment_contracts
         (employee_id, contract_number, contract_type, start_date, end_date,
          probation_end_date, parent_contract_id, sequence, position_title,
          department_name, work_location, base_salary, notes, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, contract_number`,
      [
        input.employeeId,
        contractNumber,
        input.contractType,
        input.startDate,
        input.endDate ?? null,
        input.probationEndDate ?? null,
        input.parentContractId ?? null,
        sequence,
        input.positionTitle ?? employee.position_title,
        input.departmentName ?? employee.department_name,
        input.workLocation ?? null,
        input.baseSalary ?? employee.base_salary,
        input.notes ?? null,
        input.createdByName ?? null,
      ]
    )
  );
  if (!contract) {
    return { ok: false, status: 422, error: "Gagal menyimpan draft kontrak" };
  }

  return { ok: true, contract };
}
