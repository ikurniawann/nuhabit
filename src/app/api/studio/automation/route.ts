import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { loadJobSettings } from "@/lib/studio/jobs-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";
import { resolveProviderAsync } from "@/lib/whatsapp";

/** Status job harian, pengaturan, riwayat run, dan log pengingat WA terbaru. */
export async function GET() {
  return studioRoute("automation GET", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.automation"]);
    const [settings, provider, runs, notifications, pending] = await Promise.all([
      loadJobSettings(ctx.branchId),
      resolveProviderAsync().catch(() => null),
      query(
        `SELECT id, job_code, run_date::text AS run_date, trigger, status, summary, error, started_at, finished_at
         FROM studio.job_runs WHERE branch_id = $1 ORDER BY started_at DESC LIMIT 20`,
        [ctx.branchId]
      ),
      query(
        `SELECT n.id, n.kind, n.status, n.error, n.message, n.created_at, n.sent_at, c.name AS member_name, n.phone
         FROM studio.member_notifications n JOIN pos.pos_customers c ON c.id = n.customer_id
         WHERE n.branch_id = $1 ORDER BY n.created_at DESC LIMIT 30`,
        [ctx.branchId]
      ),
      query<{ sessions: number; passes: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM studio.class_sessions WHERE branch_id = $1 AND status = 'scheduled'
              AND (session_date + end_time) < (now() AT TIME ZONE 'Asia/Jakarta') - interval '1 hour') AS sessions,
           (SELECT COUNT(*)::int FROM studio.member_passes WHERE branch_id = $1 AND status IN ('active','exhausted')
              AND breakage_recognized_at IS NULL AND valid_until < (now() AT TIME ZONE 'Asia/Jakarta')::date) AS passes`,
        [ctx.branchId]
      ),
    ]);
    return NextResponse.json({
      success: true,
      data: { settings, wa_provider: provider, runs, notifications, backlog: pending[0] ?? { sessions: 0, passes: 0 } },
    });
  });
}
