import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { setMemberStatus } from "@/lib/studio/loyalty-server";
import { memberStatusSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

const LABEL = { active: "diaktifkan kembali", suspended: "diblokir", banned: "di-banned" } as const;

/** Blokir / banned / aktifkan member (tier & benefit gugur selama tidak aktif). */
export async function PUT(request: NextRequest, { params }: Params) {
  return studioRoute("loyalty member status", async () => {
    const ctx = await requireStudioContext("update", ["studio.loyalty"]);
    const { id } = await params;
    const b = await validateBody(request, memberStatusSchema);
    if (b.status !== "active" && !b.reason) throw ApiError.badRequest("Alasan wajib diisi");
    await setMemberStatus(id, b.status, b.reason ?? null, ctx.user.id);
    return NextResponse.json({ success: true, message: `Member ${LABEL[b.status]}` });
  });
}
