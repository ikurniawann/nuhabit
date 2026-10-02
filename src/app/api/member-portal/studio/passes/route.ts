import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { effectivePassStatus, remainingCredits } from "@/lib/studio/pass";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { PASS_SELECT, PASS_USAGE_JOIN, venueToday, type PassRow } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";

/** Pass saya + sisa kredit (tanpa angka utang/akuntansi). */
export async function GET() {
  return studioRoute("member passes", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const rows = await query<PassRow>(
      `SELECT ${PASS_SELECT}
       FROM studio.member_passes mp JOIN pos.pos_customers c ON c.id = mp.customer_id
       ${PASS_USAGE_JOIN}
       WHERE mp.customer_id = $1 AND mp.branch_id = $2 AND mp.status <> 'pending_payment'
       ORDER BY mp.valid_until DESC LIMIT 20`,
      [customerId, actor.branchId]
    );
    const today = await venueToday();
    const data = rows.map((p) => {
      const balance = { class_total: p.class_credits_total, pt_total: p.pt_credits_total, class_used: p.class_used, pt_used: p.pt_used };
      const left = remainingCredits(balance);
      return {
        id: p.id, pass_code: p.pass_code, product_name: p.product_name, category: p.category,
        class_credits_total: p.class_credits_total, pt_credits_total: p.pt_credits_total, facility_access: p.facility_access,
        class_left: left.class, pt_left: left.pt, valid_from: p.valid_from, valid_until: p.valid_until,
        status: effectivePassStatus(p, balance, today),
      };
    });
    return NextResponse.json({ success: true, data });
  });
}
