import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query } from "@/lib/db";

/**
 * GET /api/hris/contracts/expiring?days=30 — pengingat Fase C:
 *   • kontrak aktif yang akan/telah lewat tanggal berakhir dalam N hari
 *     (termasuk yang sudah terlewat tapi belum diakhiri — days_left negatif)
 *   • masa percobaan PKWTT aktif yang akan berakhir dalam N hari
 *   • karyawan aktif TANPA kontrak aktif (PKWT wajib tertulis sebelum mulai
 *     bekerja — PP 35/2021); magang di luar scope kontrak
 * Dipakai banner di halaman direktori Karyawan & halaman HRIS → Kontrak.
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

export interface ExpiringContractRow {
  contract_id: string;
  employee_id: string;
  employee_name: string;
  contract_number: string;
  contract_type: "pkwt" | "pkwtt";
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

export async function GET(req: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const daysParam = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
    const days = Number.isFinite(daysParam)
      ? Math.min(Math.max(Math.trunc(daysParam), 1), MAX_DAYS)
      : DEFAULT_DAYS;

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
           -- akun super_admin bukan karyawan sungguhan — record employees-nya
           -- hanya wadah akun login, tidak ditagih kontrak
           AND NOT EXISTS (
             SELECT 1 FROM configuration.users u
             WHERE u.id = e.user_id AND u.role = 'super_admin'
           )
         ORDER BY e.join_date ASC NULLS LAST`
      ),
    ]);

    return NextResponse.json({ data: { days, contracts, probations, noContract } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts/expiring] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
