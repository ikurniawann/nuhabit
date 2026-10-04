import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import { deletePrivateFile, savePrivateDocument } from "@/lib/storage-private";
import type { ContractDocumentData } from "./contract-pdf";
import type { ContractType } from "./contracts";
import { CONTRACT_SORT_COLUMNS, type ContractListParams } from "./contracts-list";

/** Query kontrak lintas karyawan: daftar, pengingat, data PDF, dokumen ttd. */

export interface ContractListRow {
  id: string;
  employee_id: string;
  employee_name: string;
  contract_number: string;
  contract_type: ContractType;
  status: string;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  days_left: number | null;
  position_title: string | null;
  department_name: string | null;
  base_salary: string | null;
  sequence: number;
}

export async function listContracts(params: ContractListParams) {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.status) {
    values.push(params.status);
    where.push(`c.status = $${values.length}`);
  }
  if (params.contractType) {
    values.push(params.contractType);
    where.push(`c.contract_type = $${values.length}`);
  }
  if (params.search) {
    values.push(`%${params.search}%`);
    where.push(`(e.full_name ILIKE $${values.length} OR c.contract_number ILIKE $${values.length})`);
  }
  if (params.expiringWithin !== null) {
    values.push(params.expiringWithin);
    where.push(`c.end_date IS NOT NULL AND c.end_date <= current_date + $${values.length}::int`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = `ORDER BY ${CONTRACT_SORT_COLUMNS[params.sortBy]} ${params.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST, c.created_at DESC`;

  const countRow = await queryOne<{ count: string }>(
    `SELECT count(*) FROM hris.employment_contracts c
     JOIN hris.employees e ON e.id = c.employee_id
     ${whereSql}`,
    values
  );

  values.push(params.limit, (params.page - 1) * params.limit);
  const rows = await query<ContractListRow>(
    `SELECT c.id, c.employee_id, e.full_name AS employee_name,
            c.contract_number, c.contract_type, c.status,
            c.start_date, c.end_date, c.probation_end_date,
            (c.end_date - current_date)::int AS days_left,
            c.position_title, c.department_name, c.base_salary, c.sequence
     FROM hris.employment_contracts c
     JOIN hris.employees e ON e.id = c.employee_id
     ${whereSql}
     ${orderSql}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows, total: Number(countRow?.count ?? 0) };
}

const DEFAULT_EXPIRING_DAYS = 30;
const MAX_EXPIRING_DAYS = 90;

/** Rentang hari pengingat: 1..90, default 30 bila bukan angka. */
export function clampExpiringDays(raw: string | null): number {
  const value = Number(raw ?? DEFAULT_EXPIRING_DAYS);
  return Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1), MAX_EXPIRING_DAYS)
    : DEFAULT_EXPIRING_DAYS;
}

export interface ExpiringContractRow {
  contract_id: string;
  employee_id: string;
  employee_name: string;
  contract_number: string;
  contract_type: ContractType;
  position_title: string | null;
  end_date: string;
  days_left: number;
}

export interface EndingProbationRow {
  contract_id: string;
  employee_id: string;
  employee_name: string;
  contract_number: string;
  position_title: string | null;
  probation_end_date: string;
  days_left: number;
}

export interface NoActiveContractRow {
  employee_id: string;
  employee_name: string;
  employment_status: string;
  join_date: string | null;
  draft_contract_number: string | null;
  draft_start_date: string | null;
}

/**
 * Pengingat Fase C:
 *   • kontrak aktif yang akan/telah lewat tanggal berakhir dalam N hari
 *     (termasuk yang terlewat tapi belum diakhiri; days_left negatif)
 *   • masa percobaan PKWTT aktif yang berakhir dalam N hari
 *   • karyawan aktif TANPA kontrak aktif (PKWT wajib tertulis sebelum mulai
 *     bekerja, PP 35/2021); magang di luar scope kontrak
 */
export async function loadExpiringContracts(days: number) {
  const [contracts, probations, noContract] = await Promise.all([
    query<ExpiringContractRow>(
      `SELECT c.id AS contract_id, c.employee_id, e.full_name AS employee_name,
              c.contract_number, c.contract_type, c.position_title, c.end_date,
              (c.end_date - current_date)::int AS days_left
       FROM hris.employment_contracts c
       JOIN hris.employees e ON e.id = c.employee_id
       WHERE c.status = 'active'
         AND c.end_date IS NOT NULL
         AND c.end_date <= current_date + $1::int
       ORDER BY c.end_date ASC`,
      [days]
    ),
    query<EndingProbationRow>(
      `SELECT c.id AS contract_id, c.employee_id, e.full_name AS employee_name,
              c.contract_number, c.position_title, c.probation_end_date,
              (c.probation_end_date - current_date)::int AS days_left
       FROM hris.employment_contracts c
       JOIN hris.employees e ON e.id = c.employee_id
       WHERE c.status = 'active'
         AND c.probation_end_date IS NOT NULL
         AND c.probation_end_date BETWEEN current_date AND current_date + $1::int
       ORDER BY c.probation_end_date ASC`,
      [days]
    ),
    query<NoActiveContractRow>(
      `SELECT e.id AS employee_id, e.full_name AS employee_name,
              e.employment_status, e.join_date,
              d.contract_number AS draft_contract_number,
              d.start_date AS draft_start_date
       FROM hris.employees e
       LEFT JOIN LATERAL (
         SELECT contract_number, start_date FROM hris.employment_contracts c
         WHERE c.employee_id = e.id AND c.status = 'draft'
         ORDER BY c.created_at DESC LIMIT 1
       ) d ON true
       WHERE e.is_active
         AND e.employment_status <> 'internship'
         AND NOT EXISTS (
           SELECT 1 FROM hris.employment_contracts c
           WHERE c.employee_id = e.id AND c.status = 'active'
         )
         -- akun super_admin bukan karyawan sungguhan: record employees-nya
         -- hanya wadah akun login, tidak ditagih kontrak
         AND NOT EXISTS (
           SELECT 1 FROM configuration.users u
           WHERE u.id = e.user_id AND u.role = 'super_admin'
         )
       ORDER BY e.join_date ASC NULLS LAST`
    ),
  ]);
  return { days, contracts, probations, noContract };
}

interface ContractDocumentRow {
  contract_number: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  position_title: string | null;
  department_name: string | null;
  work_location: string | null;
  base_salary: string | null;
  signed_at: string | null;
  full_name: string;
  ktp: string | null;
  address: string | null;
  city: string | null;
  birth_date: string | null;
  phone: string | null;
}

/**
 * Snapshot kontrak + profil perusahaan (app_settings company_*) untuk PDF
 * surat perjanjian kerja. Nilai kosong dirender sebagai garis isian.
 */
export async function loadContractDocument(id: string): Promise<ContractDocumentData> {
  const row = await queryOne<ContractDocumentRow>(
    `SELECT c.contract_number, c.contract_type, c.start_date, c.end_date,
            c.probation_end_date, c.position_title, c.department_name,
            c.work_location, c.base_salary, c.signed_at,
            e.full_name, e.ktp, e.address, e.city, e.birth_date, e.phone
     FROM hris.employment_contracts c
     JOIN hris.employees e ON e.id = c.employee_id
     WHERE c.id = $1`,
    [id]
  );
  if (!row) throw ApiError.notFound("Kontrak tidak ditemukan");

  const settings = await getSettings([
    SETTING_KEYS.COMPANY_LEGAL_NAME,
    SETTING_KEYS.COMPANY_ADDRESS,
    SETTING_KEYS.COMPANY_CITY,
    SETTING_KEYS.COMPANY_SIGNER_NAME,
    SETTING_KEYS.COMPANY_SIGNER_TITLE,
  ]);

  return {
    company: {
      legal_name: settings[SETTING_KEYS.COMPANY_LEGAL_NAME],
      address: settings[SETTING_KEYS.COMPANY_ADDRESS],
      city: settings[SETTING_KEYS.COMPANY_CITY],
      signer_name: settings[SETTING_KEYS.COMPANY_SIGNER_NAME],
      signer_title: settings[SETTING_KEYS.COMPANY_SIGNER_TITLE],
    },
    employee: {
      full_name: row.full_name,
      ktp: row.ktp,
      address: [row.address, row.city].filter(Boolean).join(", ") || null,
      birth_date: row.birth_date,
      phone: row.phone,
    },
    contract: {
      contract_number: row.contract_number,
      contract_type: row.contract_type,
      start_date: row.start_date,
      end_date: row.end_date,
      probation_end_date: row.probation_end_date,
      position_title: row.position_title,
      department_name: row.department_name,
      work_location: row.work_location,
      base_salary: row.base_salary ? Number(row.base_salary) : null,
      signed_at: row.signed_at,
    },
  };
}

export interface SignedDocumentContract {
  id: string;
  employee_id: string;
  contract_number: string;
  signed_document_url: string | null;
}

export async function loadSignedDocumentContract(id: string): Promise<SignedDocumentContract | null> {
  return queryOne<SignedDocumentContract>(
    `SELECT id, employee_id, contract_number, signed_document_url
     FROM hris.employment_contracts WHERE id = $1`,
    [id]
  );
}

export const MAX_SIGNED_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Simpan scan bertanda tangan; re-upload menimpa file lama (best-effort delete). */
export async function saveSignedDocument(contract: SignedDocumentContract, buffer: Buffer) {
  const saved = await savePrivateDocument(buffer, `contract-signed/${contract.employee_id}`);
  if (!saved.path) throw ApiError.badRequest(saved.error ?? "Gagal menyimpan dokumen");

  // ttd default hari ini bila belum pernah diisi; bisa dikoreksi via aksi update
  await queryOne(
    `UPDATE hris.employment_contracts
     SET signed_document_url = $2, signed_at = COALESCE(signed_at, now()::date)
     WHERE id = $1 RETURNING id`,
    [contract.id, saved.path]
  );
  if (contract.signed_document_url) {
    await deletePrivateFile(contract.signed_document_url);
  }
}

export async function removeSignedDocument(contract: SignedDocumentContract) {
  if (!contract.signed_document_url) {
    throw ApiError.conflict("Kontrak ini belum punya dokumen bertanda tangan");
  }
  await queryOne(
    `UPDATE hris.employment_contracts
     SET signed_document_url = NULL WHERE id = $1 RETURNING id`,
    [contract.id]
  );
  await deletePrivateFile(contract.signed_document_url);
}
