import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { runDailyClose, runReminders } from "@/lib/studio/jobs-server";
import { jobRunSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Jalankan job sekarang (manual) — langkah idempoten, aman diulang. */
export async function POST(request: NextRequest) {
  return studioRoute("automation run", async () => {
    const ctx = await requireStudioContext("update", ["studio.automation"]);
    const { job } = await validateBody(request, jobRunSchema);
    const venue = { companyId: ctx.companyId, branchId: ctx.branchId };
    if (job === "daily_close") {
      const res = await runDailyClose(venue, "manual", ctx.user.id);
      const s = res.summary;
      return NextResponse.json({
        success: !res.error,
        data: res,
        message: res.error
          ? `Tutup hari gagal: ${res.error}`
          : `Tutup hari selesai · ${s?.sessions_completed ?? 0} sesi diselesaikan, ${s?.passes_expired ?? 0} pass kedaluwarsa`,
      }, { status: res.error ? 500 : 200 });
    }
    const res = await runReminders(venue, { force: true, trigger: "manual", userId: ctx.user.id });
    if (!res.ran) return NextResponse.json({ success: false, error: res.reason }, { status: 409 });
    const s = res.summary!;
    return NextResponse.json({ success: true, data: res, message: `Pengingat diproses · ${s.sent} terkirim, ${s.failed} gagal, ${s.skipped} dilewati` });
  });
}
