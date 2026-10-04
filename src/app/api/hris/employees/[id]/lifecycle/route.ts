import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { requireEmployeeAccess } from "@/lib/hris/employee-access";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/hris/employees/[id]/lifecycle — perjalanan hidup karyawan utk
 * tab Lifecycle: rekrutmen (dari data kandidat yang dipromosikan) → join →
 * onboarding → akun aplikasi → riwayat kepegawaian → offboarding → berakhir.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }
    await requireEmployeeAccess(id);

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
      [id]
    );
    if (!employee) {
      return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    }

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
        [id]
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
        [id]
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
        [id]
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
        [id]
      ),
    ]);

    return NextResponse.json({
      data: {
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
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[employee-lifecycle] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
