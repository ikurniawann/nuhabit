import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { loadPass } from "@/lib/studio/pass-server";
import { passAdjustSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Koreksi kredit manual (mis. kompensasi kelas batal, salah input). Nilai rupiah
 * tidak berpindah — revenue hanya diakui lewat redeem/expire — jadi penyesuaian
 * tidak memengaruhi jurnal, cukup tercatat di ledger dengan alasan.
 */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("pass adjust", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const b = await validateBody(request, passAdjustSchema);
    const pass = await loadPass(ctx.branchId, id);
    if (!pass) throw ApiError.notFound("Pass tidak ditemukan");
    if (pass.status === "cancelled" || pass.breakage_recognized_at) throw ApiError.conflict("Pass sudah dibatalkan/kedaluwarsa");
    const total = b.credit_type === "class" ? pass.class_credits_total : pass.pt_credits_total;
    const used = b.credit_type === "class" ? pass.class_used : pass.pt_used;
    // qty positif = kredit dikembalikan (used turun), negatif = kredit dikurangi.
    const nextUsed = used - b.qty;
    if (nextUsed < 0) throw ApiError.badRequest(`Tidak bisa menambah melebihi kuota paket (${total} kredit)`);
    if (nextUsed > total) throw ApiError.badRequest("Sisa kredit tidak cukup untuk dikurangi");
    await query(
      `INSERT INTO studio.pass_credit_ledger (company_id, branch_id, pass_id, entry_type, credit_type, qty, note, created_by)
       VALUES ($1,$2,$3,'adjust',$4,$5,$6,$7)`,
      [ctx.companyId, ctx.branchId, id, b.credit_type, b.qty, b.note, ctx.user.id]
    );
    const status = nextUsed >= total && (b.credit_type === "class" ? pass.pt_credits_total - pass.pt_used : pass.class_credits_total - pass.class_used) <= 0 && !pass.facility_access
      ? "exhausted" : "active";
    await query(`UPDATE studio.member_passes SET status = $2, updated_at = now() WHERE id = $1 AND status IN ('active','exhausted')`, [id, status]);
    return NextResponse.json({ success: true, message: `Kredit ${b.credit_type === "class" ? "kelas" : "Personal Training"} ${b.qty > 0 ? "+" : ""}${b.qty}` });
  });
}
