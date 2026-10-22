import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { deptTaskActor } from "@/lib/hris/dept-tasks";
import { loadDeptTaskMonitor } from "@/lib/hris/dept-task-monitor-server";

/**
 * GET /api/hris/dept-tasks/monitor?month=YYYY-MM[&department_id=..] —
 * pemantauan progres Task Departemen (EPIC-068): ringkasan per departemen &
 * penanggung jawab, task terlambat, menunggu review. HR melihat semua
 * departemen (atau satu bila difilter); karyawan lain hanya departemennya.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  try {
    const me = await deptTaskActor();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const month = req.nextUrl.searchParams.get("month") ?? "";
    if (!MONTH_RE.test(month)) {
      return NextResponse.json({ error: "Parameter month wajib (YYYY-MM)" }, { status: 400 });
    }
    const requested = req.nextUrl.searchParams.get("department_id");
    let departmentIds: string[];
    if (me.isHr) {
      departmentIds = requested && UUID_RE.test(requested)
        ? [requested]
        : (await query<{ id: string }>(`SELECT id FROM hris.departments ORDER BY name`)).map((d) => d.id);
    } else {
      departmentIds = me.departmentId ? [me.departmentId] : [];
    }
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const data = await loadDeptTaskMonitor(departmentIds, `${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`, today);
    return NextResponse.json({ data: { ...data, is_hr: me.isHr, scope: me.isHr ? "all" : "own" } });
  } catch (error) {
    console.error("[dept-tasks/monitor] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
