import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";

/**
 * GET /api/hris/employees/[id]/recruitment-documents — dokumen asal rekrutmen
 * milik karyawan (dari kandidat yang dipromosikan): CV/resume dan ketersediaan
 * Laporan Pipeline. Dipakai tab Dokumen di detail karyawan HRD/super admin.
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const REPORT_STAGES = new Set(["offer", "hired"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }

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
      [id]
    );

    return NextResponse.json({
      data: candidate
        ? {
            candidate_id: candidate.id,
            cv_url: candidate.cv_url,
            status: candidate.status,
            applied_at: candidate.created_at,
            position_title: candidate.position_title,
            report_available: REPORT_STAGES.has(candidate.status),
          }
        : null,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[employee-recruitment-documents] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
