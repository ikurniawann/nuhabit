import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("member news detail", async () => {
    const { actor } = await requireMemberStudio();
    const { id } = await params;
    const row = await queryOne(
      `SELECT id, title, category, summary, body, image_url, published_at
       FROM studio.news WHERE id = $1 AND branch_id = $2 AND status = 'published'`,
      [id, actor.branchId]
    );
    if (!row) throw ApiError.notFound("News tidak ditemukan");
    return NextResponse.json({ success: true, data: row });
  });
}
