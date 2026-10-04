import { z } from "zod";
import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  computeKompensasi,
  monthsWorked,
  pkwtChainTotalMonths,
  validateContractDates,
  validatePkwtTotal,
  type ContractType,
} from "./contracts";
import { withContractNumber } from "./contract-number";

/**
 * Aksi siklus hidup kontrak (PATCH /api/hris/contracts/[id]):
 *   activate  draft → active   (sinkron employment_status + employment_history)
 *   end       active → ended   (PKWT: hitung uang kompensasi PP 35/2021)
 *   terminate draft|active → terminated (PKWT aktif: kompensasi pro-rata)
 *   convert   active PKWT → converted (lanjut buat kontrak PKWTT baru)
 *   renew     active PKWT → draft perpanjangan dalam rantai yang sama
 *   edit      ubah isi draft (tanggal, gaji, lokasi; validasi compliance ulang)
 *   update    edit metadata (ttd, dokumen, pencatatan Kemnaker, pembayaran)
 * Setiap aksi melempar ApiError (409 status salah, 400 input, 422 batas PKWT).
 */

export interface ContractRow {
  id: string;
  employee_id: string;
  contract_number: string;
  contract_type: ContractType;
  status: string;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  base_salary: string | null;
  position_title: string | null;
  department_name: string | null;
  work_location: string | null;
  notes: string | null;
  signed_at: string | null;
  kemnaker_registered_at: string | null;
  compensation_paid_at: string | null;
  sequence: number;
}

const optionalDate = z.string().max(10).nullable().optional();
const optionalText = (max: number) => z.string().max(max).nullable().optional();

export const CONTRACT_ACTIONS = [
  "activate",
  "end",
  "terminate",
  "convert",
  "renew",
  "edit",
  "update",
] as const;
export type ContractAction = (typeof CONTRACT_ACTIONS)[number];

export const contractActionSchema = z.object({
  action: z.enum(CONTRACT_ACTIONS, { error: "Aksi tidak dikenal" }),
  end_date: optionalDate,
  reason: z.string().max(2000).optional(),
  signed_at: optionalDate,
  // hanya path hasil upload route signed-document; cegah menunjuk berkas lain
  signed_document_url: z
    .string()
    .regex(/^contract-signed\/[\w-]+\/[\w.-]+$/, "Path dokumen tidak valid")
    .refine((path) => !path.includes(".."), "Path dokumen tidak valid")
    .optional(),
  kemnaker_registered_at: optionalDate,
  compensation_paid_at: optionalDate,
  notes: optionalText(5000),
  start_date: z.string().max(10).optional(),
  probation_end_date: optionalDate,
  position_title: optionalText(255),
  work_location: optionalText(255),
  base_salary: z.union([z.number(), z.string().max(30)]).nullable().optional(),
});

export type ContractActionInput = z.infer<typeof contractActionSchema>;

export interface ContractActionResult {
  message: string;
  compensation_amount?: number | null;
}

type PkwtPeriod = { start_date: string; end_date: string | null };

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Status kepegawaian baru saat kontrak diaktifkan. */
export function employmentStatusOnActivate(
  contract: Pick<ContractRow, "contract_type" | "probation_end_date">,
  today: string
): "contract" | "probation" | "permanent" {
  if (contract.contract_type === "pkwt") return "contract";
  const inProbation = contract.probation_end_date !== null && contract.probation_end_date >= today;
  return inProbation ? "probation" : "permanent";
}

/** Perpanjangan PKWT mulai sehari setelah kontrak lama berakhir. */
export function renewalStartDate(endDate: string | null): string {
  const start = new Date(`${endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

/** Field yang tidak dikirim (undefined) dipertahankan; null mengosongkan. */
function keep<T>(sent: T | undefined, current: T): T {
  return sent !== undefined ? sent : current;
}

export function mergeDraftEdit(contract: ContractRow, body: ContractActionInput) {
  return {
    start_date: keep(body.start_date, contract.start_date),
    end_date: keep(body.end_date, contract.end_date),
    probation_end_date: keep(body.probation_end_date, contract.probation_end_date),
    position_title: keep(body.position_title, contract.position_title),
    work_location: keep(body.work_location, contract.work_location),
    base_salary: keep<string | number | null>(body.base_salary, contract.base_salary),
    notes: keep(body.notes, contract.notes),
  };
}

export async function loadContract(id: string): Promise<ContractRow | null> {
  return queryOne<ContractRow>(
    `SELECT id, employee_id, contract_number, contract_type, status,
            start_date, end_date, probation_end_date, base_salary,
            position_title, department_name, work_location, notes,
            signed_at, kemnaker_registered_at, compensation_paid_at, sequence
     FROM hris.employment_contracts WHERE id = $1`,
    [id]
  );
}

async function loadPkwtChain(employeeId: string): Promise<PkwtPeriod[]> {
  return query<PkwtPeriod>(
    `SELECT start_date, end_date FROM hris.employment_contracts
     WHERE employee_id = $1 AND contract_type = 'pkwt' AND status <> 'draft'`,
    [employeeId]
  );
}

/** Batas total PKWT 5 tahun (PP 35/2021) atas rantai non-draft + periode baru. */
async function assertPkwtTotal(employeeId: string, start: string, end: string) {
  const totalError = validatePkwtTotal(
    pkwtChainTotalMonths(await loadPkwtChain(employeeId)),
    monthsWorked(start, end)
  );
  if (totalError) throw new ApiError(422, totalError);
}

export async function runContractAction(
  contract: ContractRow,
  body: ContractActionInput,
  user: { id: string; full_name: string }
): Promise<ContractActionResult> {
  switch (body.action) {
    case "activate":
      return activate(contract, body, user.id);
    case "end":
      return end(contract, body);
    case "terminate":
      return terminate(contract, body);
    case "convert":
      return convert(contract);
    case "renew":
      return renew(contract, body, user.full_name);
    case "edit":
      return editDraft(contract, body);
    case "update":
      return updateMeta(contract, body);
  }
}

async function activate(
  contract: ContractRow,
  body: ContractActionInput,
  userId: string
): Promise<ContractActionResult> {
  if (contract.status !== "draft") {
    throw ApiError.conflict("Hanya kontrak berstatus draft yang bisa diaktifkan");
  }
  const activeOther = await queryOne<{ contract_number: string }>(
    `SELECT contract_number FROM hris.employment_contracts
     WHERE employee_id = $1 AND status = 'active' AND id <> $2`,
    [contract.employee_id, contract.id]
  );
  if (activeOther) {
    throw ApiError.conflict(
      `Karyawan masih punya kontrak aktif (${activeOther.contract_number}) — akhiri dulu sebelum mengaktifkan kontrak baru`
    );
  }

  const employee = await queryOne<{ employment_status: string }>(
    `SELECT employment_status FROM hris.employees WHERE id = $1`,
    [contract.employee_id]
  );
  // recorded_by ber-FK ke hris.employees(id): petakan dari akun auth;
  // NULL bila akun yang mengaktifkan tidak terhubung ke record karyawan
  const recorder = await queryOne<{ id: string }>(
    `SELECT id FROM hris.employees WHERE user_id = $1`,
    [userId]
  );
  const newStatus = employmentStatusOnActivate(contract, todayIso());

  // satu transaksi: kegagalan salah satu langkah tidak boleh meninggalkan
  // kontrak aktif tanpa sinkron status karyawan/riwayat
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE hris.employment_contracts
       SET status = 'active', signed_at = COALESCE($2::date, signed_at, now()::date)
       WHERE id = $1`,
      [contract.id, body.signed_at ?? null]
    );
    await client.query(
      `UPDATE hris.employees SET employment_status = $2, end_date = $3
       WHERE id = $1`,
      [contract.employee_id, newStatus, contract.contract_type === "pkwt" ? contract.end_date : null]
    );
    await client.query(
      `INSERT INTO hris.employment_history
         (employee_id, change_type, effective_date, prev_employment_status,
          new_employment_status, reason, recorded_by)
       VALUES ($1, 'contract_activated', $2, $3, $4, $5, $6)`,
      [
        contract.employee_id,
        contract.start_date,
        employee?.employment_status ?? null,
        newStatus,
        `Kontrak ${contract.contract_number} (${contract.contract_type.toUpperCase()}) aktif`,
        recorder?.id ?? null,
      ]
    );
    await syncSalaryFromContract(client, contract);
  });

  return { message: `Kontrak ${contract.contract_number} diaktifkan` };
}

interface SalaryVersionRow {
  id: string;
  base_salary: string;
  fixed_allowance: string | null;
  variable_allowance: string | null;
  transport_allowance: string | null;
  meal_allowance: string | null;
  housing_allowance: string | null;
  loan_deduction: string | null;
  other_deduction: string | null;
  ptkp_status: string | null;
  is_taxable: boolean | null;
  bpjs_tk_enrolled: boolean | null;
  bpjs_kes_enrolled: boolean | null;
  tapera_enrolled: boolean | null;
}

/**
 * EPIC-008 Fase C: sinkronkan snapshot gaji kontrak → struktur gaji payroll
 * (versi baru hris.employee_salary) agar dua sumber gaji tidak menyimpang.
 * Hanya bila kontrak mencantumkan gaji pokok.
 */
async function syncSalaryFromContract(client: PoolClient, contract: ContractRow) {
  const contractBase = contract.base_salary !== null ? Number(contract.base_salary) : null;
  if (contractBase === null || contractBase <= 0) return;

  const { rows } = await client.query<SalaryVersionRow>(
    `SELECT * FROM hris.employee_salary
     WHERE employee_id = $1 AND is_active = true
     ORDER BY effective_date DESC LIMIT 1`,
    [contract.employee_id]
  );
  const current = rows[0];
  if (current && Number(current.base_salary) === contractBase) return;

  if (current) {
    await client.query(
      `UPDATE hris.employee_salary
       SET is_active = false,
           end_date = ($2::date - INTERVAL '1 day')::date,
           updated_at = now()
       WHERE id = $1`,
      [current.id, contract.start_date]
    );
  }
  // Tunjangan/PTKP/flag BPJS dibawa dari versi sebelumnya (kontrak hanya
  // menyimpan gaji pokok); karyawan baru memakai default tabel.
  await client.query(
    `INSERT INTO hris.employee_salary
       (employee_id, base_salary, fixed_allowance, variable_allowance,
        transport_allowance, meal_allowance, housing_allowance,
        loan_deduction, other_deduction, ptkp_status, is_taxable,
        bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled,
        effective_date, is_active, notes)
     VALUES ($1, $2,
             COALESCE($3, 0), COALESCE($4, 0), COALESCE($5, 0),
             COALESCE($6, 0), COALESCE($7, 0),
             COALESCE($8, 0), COALESCE($9, 0),
             COALESCE($10, 'TK/0'), COALESCE($11, true),
             COALESCE($12, true), COALESCE($13, true), COALESCE($14, true),
             $15::date, true, $16)
     ON CONFLICT (employee_id, effective_date) DO UPDATE SET
       base_salary = EXCLUDED.base_salary,
       is_active = true,
       end_date = NULL,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [
      contract.employee_id,
      contractBase,
      current?.fixed_allowance ?? null,
      current?.variable_allowance ?? null,
      current?.transport_allowance ?? null,
      current?.meal_allowance ?? null,
      current?.housing_allowance ?? null,
      current?.loan_deduction ?? null,
      current?.other_deduction ?? null,
      current?.ptkp_status ?? null,
      current?.is_taxable ?? null,
      current?.bpjs_tk_enrolled ?? null,
      current?.bpjs_kes_enrolled ?? null,
      current?.tapera_enrolled ?? null,
      contract.start_date,
      `Sinkron dari kontrak ${contract.contract_number}`,
    ]
  );
}

async function end(contract: ContractRow, body: ContractActionInput): Promise<ContractActionResult> {
  if (contract.status !== "active") {
    throw ApiError.conflict("Hanya kontrak aktif yang bisa diakhiri");
  }
  const actualEnd = body.end_date ?? contract.end_date ?? todayIso();
  const compensation =
    contract.contract_type === "pkwt"
      ? computeKompensasi(Number(contract.base_salary ?? 0), contract.start_date, actualEnd)
      : null;

  await queryOne(
    `UPDATE hris.employment_contracts
     SET status = 'ended', end_date = $2, compensation_amount = $3
     WHERE id = $1 RETURNING id`,
    [contract.id, actualEnd, compensation]
  );
  return {
    message: `Kontrak ${contract.contract_number} berakhir`,
    compensation_amount: compensation,
  };
}

async function terminate(
  contract: ContractRow,
  body: ContractActionInput
): Promise<ContractActionResult> {
  if (contract.status !== "draft" && contract.status !== "active") {
    throw ApiError.conflict("Kontrak sudah tidak berjalan");
  }
  const reason = body.reason?.trim();
  if (!reason) throw ApiError.badRequest("Alasan pemutusan kontrak wajib diisi");

  // PKWT diputus lebih awal: kompensasi tetap pro-rata masa kerja berjalan
  const compensation =
    contract.contract_type === "pkwt" && contract.status === "active"
      ? computeKompensasi(Number(contract.base_salary ?? 0), contract.start_date, todayIso())
      : null;

  await queryOne(
    `UPDATE hris.employment_contracts
     SET status = 'terminated', terminated_reason = $2, compensation_amount = $3
     WHERE id = $1 RETURNING id`,
    [contract.id, reason, compensation]
  );
  return {
    message: `Kontrak ${contract.contract_number} diputus`,
    compensation_amount: compensation,
  };
}

async function convert(contract: ContractRow): Promise<ContractActionResult> {
  if (contract.status !== "active" || contract.contract_type !== "pkwt") {
    throw ApiError.conflict("Hanya kontrak PKWT aktif yang bisa dikonversi ke PKWTT");
  }
  await queryOne(
    `UPDATE hris.employment_contracts SET status = 'converted' WHERE id = $1 RETURNING id`,
    [contract.id]
  );
  return {
    message: `Kontrak ${contract.contract_number} ditandai konversi — buat kontrak PKWTT baru untuk karyawan ini`,
  };
}

/**
 * Perpanjang PKWT: buat draft kontrak lanjutan dalam rantai parent_contract_id.
 * Kontrak lama tetap aktif sampai tanggalnya; draft baru diaktifkan setelah
 * kontrak lama diakhiri.
 */
async function renew(
  contract: ContractRow,
  body: ContractActionInput,
  createdByName: string
): Promise<ContractActionResult> {
  if (contract.status !== "active" || contract.contract_type !== "pkwt") {
    throw ApiError.conflict("Hanya kontrak PKWT aktif yang bisa diperpanjang");
  }
  if (!body.end_date) {
    throw ApiError.badRequest("Tanggal berakhir kontrak perpanjangan wajib diisi");
  }
  const newStart = renewalStartDate(contract.end_date);
  if (body.end_date <= newStart) {
    throw ApiError.badRequest(`Tanggal berakhir perpanjangan harus setelah ${newStart}`);
  }
  await assertPkwtTotal(contract.employee_id, newStart, body.end_date);

  const endDate = body.end_date;
  const created = await withContractNumber("pkwt", (contractNumber) =>
    queryOne<{ contract_number: string }>(
      `INSERT INTO hris.employment_contracts
         (employee_id, contract_number, contract_type, start_date, end_date,
          parent_contract_id, sequence, position_title, department_name,
          work_location, base_salary, created_by_name)
       VALUES ($1,$2,'pkwt',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING contract_number`,
      [
        contract.employee_id,
        contractNumber,
        newStart,
        endDate,
        contract.id,
        contract.sequence + 1,
        contract.position_title,
        contract.department_name,
        contract.work_location,
        contract.base_salary,
        createdByName,
      ]
    )
  );
  return {
    message: `Draft perpanjangan ${created?.contract_number} dibuat (mulai ${newStart}) — aktifkan setelah kontrak berjalan berakhir`,
  };
}

/**
 * Edit isi draft. Tipe kontrak tidak bisa diubah (nomor kontrak mengikat
 * tipe; hapus draft lalu buat ulang bila salah tipe). Seluruh aturan
 * compliance divalidasi ulang atas hasil gabungan.
 */
async function editDraft(
  contract: ContractRow,
  body: ContractActionInput
): Promise<ContractActionResult> {
  if (contract.status !== "draft") {
    throw ApiError.conflict("Hanya kontrak berstatus draft yang bisa diedit");
  }
  const merged = mergeDraftEdit(contract, body);
  if (!merged.start_date) throw ApiError.badRequest("Tanggal mulai wajib diisi");
  if (merged.base_salary !== null) {
    const salary = Number(merged.base_salary);
    if (!Number.isFinite(salary) || salary < 0) {
      throw ApiError.badRequest("Gaji pokok tidak valid");
    }
  }

  const dateErrors = validateContractDates({
    contract_type: contract.contract_type,
    start_date: merged.start_date,
    end_date: merged.end_date,
    probation_end_date: merged.probation_end_date,
  });
  if (dateErrors.length > 0) throw ApiError.badRequest(dateErrors.join(" "));

  if (contract.contract_type === "pkwt") {
    await assertPkwtTotal(
      contract.employee_id,
      merged.start_date,
      merged.end_date ?? merged.start_date
    );
  }

  // guard status di UPDATE: draft bisa keburu diaktifkan request lain
  const updated = await queryOne<{ id: string }>(
    `UPDATE hris.employment_contracts
     SET start_date         = $2,
         end_date           = $3,
         probation_end_date = $4,
         position_title     = $5,
         work_location      = $6,
         base_salary        = $7,
         notes              = $8
     WHERE id = $1 AND status = 'draft' RETURNING id`,
    [
      contract.id,
      merged.start_date,
      merged.end_date,
      merged.probation_end_date,
      merged.position_title,
      merged.work_location,
      merged.base_salary,
      merged.notes,
    ]
  );
  if (!updated) throw ApiError.conflict("Kontrak sudah bukan draft — muat ulang halaman");

  return { message: `Draft kontrak ${contract.contract_number} diperbarui` };
}

/** Tanggal administrasi yang salah isi bisa dikoreksi (null) atau dipertahankan (undefined). */
async function updateMeta(
  contract: ContractRow,
  body: ContractActionInput
): Promise<ContractActionResult> {
  await queryOne(
    `UPDATE hris.employment_contracts
     SET signed_at              = $2::date,
         signed_document_url    = COALESCE($3, signed_document_url),
         kemnaker_registered_at = $4::date,
         compensation_paid_at   = $5::date,
         notes                  = $6
     WHERE id = $1 RETURNING id`,
    [
      contract.id,
      keep(body.signed_at, contract.signed_at),
      body.signed_document_url ?? null,
      keep(body.kemnaker_registered_at, contract.kemnaker_registered_at),
      keep(body.compensation_paid_at, contract.compensation_paid_at),
      keep(body.notes, contract.notes),
    ]
  );
  return { message: "Kontrak diperbarui" };
}

/** Hapus kontrak, hanya yang masih draft. */
export async function deleteDraftContract(id: string): Promise<void> {
  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM hris.employment_contracts
     WHERE id = $1 AND status = 'draft' RETURNING id`,
    [id]
  );
  if (!deleted) throw ApiError.conflict("Hanya draft kontrak yang bisa dihapus");
}
