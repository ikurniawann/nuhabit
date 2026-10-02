import { NextRequest, NextResponse } from "next/server";
import { MEMBER_SESSION_COOKIE, memberSessionCookieOptions } from "@/lib/member-portal/session";
import { createPreviewSession, MEMBER_PREVIEW_COOKIE, MEMBER_PREVIEW_TTL_MS } from "@/lib/studio/member-preview";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Buka Member App sebagai member ini (tanpa OTP) — sesi 4 jam di browser staf. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("member app preview", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const { token, memberName } = await createPreviewSession(id, ctx.user.id);
    const res = NextResponse.json({ success: true, data: { url: "/member" }, message: `Member App dibuka sebagai ${memberName ?? "member"}` });
    const maxAge = MEMBER_PREVIEW_TTL_MS / 1000;
    res.cookies.set(MEMBER_SESSION_COOKIE, token, { ...memberSessionCookieOptions(request), maxAge });
    res.cookies.set(MEMBER_PREVIEW_COOKIE, memberName ?? "member", { ...memberSessionCookieOptions(request), httpOnly: false, maxAge });
    return res;
  });
}
