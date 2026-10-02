import { NextResponse } from "next/server";
import { isMemberPreviewEnabled } from "@/lib/studio/member-preview";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Apakah tombol "Buka Member App" ditampilkan (MEMBER_PREVIEW_ENABLED). */
export async function GET() {
  return studioRoute("member preview flag", async () => {
    await requireStudioContext();
    return NextResponse.json({ success: true, data: { enabled: isMemberPreviewEnabled() } });
  });
}
