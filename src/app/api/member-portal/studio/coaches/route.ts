import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

/** Profil coach publik untuk Member App: Head Coach dulu, lalu urutan tampil. */
export async function GET() {
  return studioRoute("member coaches", async () => {
    const { actor } = await requireMemberStudio();
    const rows = await query(
      `SELECT c.id, COALESCE(c.display_name, c.full_name) AS name, c.level, c.photo_url, c.bio, c.certifications, c.specialties,
              EXISTS (SELECT 1 FROM studio.coach_programs cp JOIN studio.programs p ON p.id = cp.program_id
                      WHERE cp.coach_id = c.id AND p.kind = 'pt' AND p.is_active) AS offers_pt
       FROM studio.coaches c
       WHERE c.branch_id = $1 AND c.is_active AND c.is_public
       ORDER BY CASE c.level WHEN 'head_coach' THEN 0 ELSE 1 END, c.sort_order, c.full_name`,
      [actor.branchId]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}
