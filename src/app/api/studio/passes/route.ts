import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { effectivePassStatus, outstandingLiability, remainingCredits } from "@/lib/studio/pass";
import { issuePass, PASS_SELECT, PASS_USAGE_JOIN, recognizedOf, venueToday, type PassRow } from "@/lib/studio/pass-server";
import { passSellSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

function decorate(p: PassRow, today: string) {
  const balance = { class_total: p.class_credits_total, pt_total: p.pt_credits_total, class_used: p.class_used, pt_used: p.pt_used };
  const left = remainingCredits(balance);
  return {
    ...p,
    class_left: left.class,
    pt_left: left.pt,
    effective_status: effectivePassStatus(p, balance, today),
    liability: outstandingLiability({ ...p, breakage_recognized: Boolean(p.breakage_recognized_at) }, recognizedOf(p)),
  };
}

/** GET ?view=active|all&q=nama/HP/kode&customer_id= */
export async function GET(request: NextRequest) {
  return studioRoute("passes GET", async () => {
    const ctx = await requireStudioContext();
    const sp = request.nextUrl.searchParams;
    const view = sp.get("view") === "all" ? "all" : "active";
    const q = (sp.get("q") ?? "").trim();
    const customerId = sp.get("customer_id");
    const params: unknown[] = [ctx.branchId];
    const where: string[] = ["mp.branch_id = $1"];
    if (view === "active") where.push(`mp.status IN ('active','exhausted') AND mp.breakage_recognized_at IS NULL`);
    if (customerId) {
      params.push(customerId);
      where.push(`mp.customer_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`, `%${q.replace(/\D/g, "") || "~"}%`);
      where.push(`(c.name ILIKE $${params.length - 1} OR mp.pass_code ILIKE $${params.length - 1} OR c.phone LIKE $${params.length})`);
    }
    const rows = await query<PassRow>(
      `SELECT ${PASS_SELECT}
       FROM studio.member_passes mp
       JOIN pos.pos_customers c ON c.id = mp.customer_id
       ${PASS_USAGE_JOIN}
       WHERE ${where.join(" AND ")}
       ORDER BY mp.valid_until ${view === "active" ? "ASC" : "DESC"}, mp.created_at DESC
       LIMIT 300`,
      params
    );
    const today = await venueToday();
    const data = rows.map((r) => decorate(r, today));

    // Ringkasan seluruh venue (bukan hanya hasil filter).
    const all = await query<PassRow>(
      `SELECT ${PASS_SELECT}
       FROM studio.member_passes mp
       JOIN pos.pos_customers c ON c.id = mp.customer_id
       ${PASS_USAGE_JOIN}
       WHERE mp.branch_id = $1 AND mp.status IN ('active','exhausted') AND mp.breakage_recognized_at IS NULL`,
      [ctx.branchId]
    );
    const decorated = all.map((r) => decorate(r, today));
    const due = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM studio.member_passes
       WHERE branch_id = $1 AND status IN ('active','exhausted') AND breakage_recognized_at IS NULL
         AND valid_until < (now() AT TIME ZONE 'Asia/Jakarta')::date`,
      [ctx.branchId]
    );
    const summary = {
      active_passes: decorated.filter((p) => p.effective_status === "active").length,
      liability: Math.round(decorated.reduce((s, p) => s + p.liability, 0) * 100) / 100,
      class_credits_left: decorated.reduce((s, p) => s + p.class_left, 0),
      pt_credits_left: decorated.reduce((s, p) => s + p.pt_left, 0),
      expiring_7d: decorated.filter((p) => p.effective_status === "active" && p.valid_until <= addDaysIso(today, 7)).length,
      due_for_expiry: Number(due?.c ?? 0),
    };
    return NextResponse.json({ success: true, data, summary, today });
  });
}

function addDaysIso(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Jual pass di front desk (lunas di tempat). */
export async function POST(request: NextRequest) {
  return studioRoute("passes POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, passSellSchema);
    const member = await queryOne(`SELECT id FROM pos.pos_customers WHERE id = $1`, [b.customer_id]);
    if (!member) throw ApiError.notFound("Member tidak ditemukan");
    const pass = await issuePass(ctx, b);
    return NextResponse.json(
      { success: true, data: decorate(pass, await venueToday()), message: `Pass ${pass.pass_code} aktif untuk ${pass.member_name ?? pass.member_phone}` },
      { status: 201 }
    );
  });
}
