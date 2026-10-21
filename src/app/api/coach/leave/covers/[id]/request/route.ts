import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requestSubstitute } from "@/lib/studio/coach-cover-server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { substituteChoiceSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Coach yang cuti meminta coach lain menggantikan satu sesi; calon pengganti dikabari via WA. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach cover request", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    const body = await validateBody(request, substituteChoiceSchema);
    const data = await requestSubstitute(id, coach.id, body.substitute_coach_id);
    return NextResponse.json({ success: true, data, message: "Permintaan terkirim — menunggu jawaban pengganti" });
  });
}
