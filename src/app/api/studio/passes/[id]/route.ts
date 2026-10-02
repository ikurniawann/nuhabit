import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { effectivePassStatus, outstandingLiability, remainingCredits } from "@/lib/studio/pass";
import { loadPass, recognizedOf, venueToday } from "@/lib/studio/pass-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Detail pass + riwayat kredit. */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("pass detail GET", async () => {
    const ctx = await requireStudioContext();
    const { id } = await params;
    const pass = await loadPass(ctx.branchId, id);
    if (!pass) throw ApiError.notFound("Pass tidak ditemukan");
    const ledger = await query(
      `SELECT l.id, l.entry_type, l.credit_type, l.qty, l.amount::float8 AS amount, l.note, l.created_at,
              l.session_id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS session_time,
              pr.name AS program_name, u.full_name AS created_by_name
       FROM studio.pass_credit_ledger l
       LEFT JOIN studio.class_sessions s ON s.id = l.session_id
       LEFT JOIN studio.programs pr ON pr.id = s.program_id
       LEFT JOIN configuration.users u ON u.id = l.created_by
       WHERE l.pass_id = $1
       ORDER BY l.created_at DESC`,
      [id]
    );
    const balance = { class_total: pass.class_credits_total, pt_total: pass.pt_credits_total, class_used: pass.class_used, pt_used: pass.pt_used };
    const left = remainingCredits(balance);
    const today = await venueToday();
    return NextResponse.json({
      success: true,
      data: {
        ...pass,
        class_left: left.class,
        pt_left: left.pt,
        effective_status: effectivePassStatus(pass, balance, today),
        liability: outstandingLiability({ ...pass, breakage_recognized: Boolean(pass.breakage_recognized_at) }, recognizedOf(pass)),
        ledger,
      },
    });
  });
}
