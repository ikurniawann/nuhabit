import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { loadPass } from "@/lib/studio/pass-server";
import { passExtendSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Freeze / perpanjang masa berlaku (cuti, sakit, kompensasi). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("pass extend", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const b = await validateBody(request, passExtendSchema);
    const pass = await loadPass(ctx.branchId, id);
    if (!pass) throw ApiError.notFound("Pass tidak ditemukan");
    if (pass.status === "cancelled" || pass.breakage_recognized_at) {
      throw ApiError.conflict("Pass yang sudah kedaluwarsa (revenue sudah diakui) atau dibatalkan tidak bisa diperpanjang");
    }
    const rows = await query<{ valid_until: string }>(
      `UPDATE studio.member_passes
       SET valid_until = valid_until + $2::int, frozen_days = frozen_days + $2::int,
           notes = concat_ws(E'\\n', notes, $3::text), updated_at = now()
       WHERE id = $1 RETURNING valid_until::text AS valid_until`,
      [id, b.days, `[${new Date().toISOString().slice(0, 10)}] +${b.days} hari: ${b.reason}`]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Berlaku sampai ${rows[0].valid_until}` });
  });
}
