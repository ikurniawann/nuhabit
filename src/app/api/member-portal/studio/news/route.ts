import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

/** News Hyrox yang sudah terbit (disematkan dulu, lalu terbaru). */
export async function GET() {
  return studioRoute("member news", async () => {
    const { actor } = await requireMemberStudio();
    const rows = await query(
      `SELECT id, title, category, summary, image_url, pinned, published_at
       FROM studio.news WHERE branch_id = $1 AND status = 'published'
       ORDER BY pinned DESC, published_at DESC LIMIT 20`,
      [actor.branchId]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}
