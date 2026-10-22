import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { memberParqStatus, submitParq } from "@/lib/studio/parq-server";
import { parqSubmitSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

/** Status & pertanyaan PAR-Q member (EPIC-067 T-067-C3). */
export async function GET() {
  return studioRoute("member parq GET", async () => {
    const { customerId } = await requireMemberStudio();
    return NextResponse.json({ success: true, data: await memberParqStatus(customerId) });
  });
}

/** Kirim PAR-Q; jawaban "ya" diteruskan ke coach sebagai penanda medis untuk ditinjau. */
export async function POST(request: NextRequest) {
  return studioRoute("member parq POST", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const b = await validateBody(request, parqSubmitSchema);
    const res = await submitParq(actor, customerId, b);
    return NextResponse.json(
      {
        success: true,
        data: { has_yes: res.has_yes },
        message: res.has_yes
          ? "Thanks — your coach will see what to look out for. If you have any doubts, please check with your doctor before training."
          : "Thanks — you're all set. We'll ask again in 12 months, or update it any time your health changes.",
      },
      { status: 201 }
    );
  });
}
