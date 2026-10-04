import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import type { ContractType } from "@/lib/hris/contracts";
import { createDraftContract } from "@/lib/hris/create-contract";

/**
 * GET  /api/hris/employees/[id]/contracts — daftar kontrak karyawan
 * POST /api/hris/employees/[id]/contracts — buat draft kontrak (PKWTT/PKWT)
 *
 * Validasi compliance (batas PKWT 5 tahun, larangan probation PKWT, probation
 * PKWTT ≤ 3 bulan) ditegakkan di sini via lib/hris/contracts sebelum insert.
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export interface ContractRow {
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

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }

    const rows = await query<ContractRow>(
      `SELECT * FROM hris.employment_contracts
       WHERE employee_id = $1
       ORDER BY created_at DESC`,
      [id]
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface CreateContractBody {
  contract_type?: string;
  start_date?: string;
  end_date?: string | null;
  probation_end_date?: string | null;
  parent_contract_id?: string | null;
  position_title?: string | null;
  department_name?: string | null;
  work_location?: string | null;
  base_salary?: number | null;
  notes?: string | null;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }

    const body = (await req.json()) as CreateContractBody;
    const contractType = body.contract_type as ContractType;
    if (contractType !== "pkwt" && contractType !== "pkwtt") {
      return NextResponse.json(
        { error: "Tipe kontrak harus 'pkwt' atau 'pkwtt'" },
        { status: 400 }
      );
    }
    if (!body.start_date) {
      return NextResponse.json({ error: "Tanggal mulai wajib diisi" }, { status: 400 });
    }

    const result = await createDraftContract({
      employeeId: id,
      contractType,
      startDate: body.start_date,
      endDate: body.end_date ?? null,
      probationEndDate: body.probation_end_date ?? null,
      parentContractId: body.parent_contract_id ?? null,
      positionTitle: body.position_title ?? null,
      departmentName: body.department_name ?? null,
      workLocation: body.work_location ?? null,
      baseSalary: body.base_salary ?? null,
      notes: body.notes ?? null,
      createdByName: user.full_name,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const created = await queryOne<ContractRow>(
      `SELECT * FROM hris.employment_contracts WHERE id = $1`,
      [result.contract.id]
    );
    return NextResponse.json(
      { data: created, message: `Draft kontrak ${result.contract.contract_number} dibuat` },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
