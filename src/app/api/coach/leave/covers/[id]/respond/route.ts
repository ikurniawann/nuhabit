import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { respondToSubstituteRequest } from "@/lib/studio/coach-cover-server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { substituteResponseSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Calon pengganti menerima atau menolak permintaan menggantikan. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach cover respond", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    const body = await validateBody(request, substituteResponseSchema);
    await respondToSubstituteRequest(id, coach.id, body.accept);
    return NextResponse.json({
      success: true,
      message: body.accept ? "Terima kasih — Anda tercatat sebagai pengganti setelah cuti disetujui" : "Permintaan ditolak",
    });
  });
}
