import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { cleanPerks } from "@/lib/studio/membership";
import { evaluateAllMemberships } from "@/lib/studio/membership-server";
import { membershipTierPatchSchema } from "@/lib/studio/schemas";
import { buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Ubah tier Membership. Ambang naik tidak langsung menurunkan member yang
 * sudah di tier ini — tier bertahan sampai masa berlakunya habis.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("membership tier PATCH", async () => {
    await requireStudioContext("update", ["studio.loyalty"]);
    const { id } = await params;
    const b = await validateBody(request, membershipTierPatchSchema);
    const body: Record<string, unknown> = { ...b };
    if (b.perks !== undefined) body.perks = cleanPerks(b.perks);
    const { sets, values } = buildSet(body);
    if (!sets.length) throw ApiError.badRequest("Tidak ada perubahan");
    const row = await queryOne<{ name: string }>(
      `UPDATE studio.membership_tiers SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND is_active RETURNING name`,
      [id, ...values]
    );
    if (!row) throw ApiError.notFound("Tier tidak ditemukan");
    const moved = await evaluateAllMemberships();
    return NextResponse.json({ success: true, message: `Tier ${row.name} disimpan${moved ? ` · ${moved} member pindah tier` : ""}` });
  });
}

/** Hapus (nonaktifkan) tier; member di tier ini dievaluasi ulang dari spending. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("membership tier DELETE", async () => {
    await requireStudioContext("delete", ["studio.loyalty"]);
    const { id } = await params;
    const row = await queryOne<{ name: string }>(
      `UPDATE studio.membership_tiers SET is_active = false, updated_at = now() WHERE id = $1 AND is_active RETURNING name`,
      [id]
    );
    if (!row) throw ApiError.notFound("Tier tidak ditemukan");
    const moved = await evaluateAllMemberships();
    return NextResponse.json({ success: true, message: `Tier ${row.name} dihapus${moved ? ` · ${moved} member pindah tier` : ""}` });
  });
}
