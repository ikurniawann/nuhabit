import { NextRequest, NextResponse } from "next/server";
import { memberSessionsForComplaint } from "@/lib/studio/complaints-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Sesi member (30 hari terakhir s/d 7 hari ke depan) untuk menautkan keluhan ke kelas & coach. */
export async function GET(request: NextRequest) {
  return studioRoute("complaint member sessions", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.complaints"]);
    const customerId = request.nextUrl.searchParams.get("customer_id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(customerId)) return NextResponse.json({ success: true, data: [] });
    return NextResponse.json({ success: true, data: await memberSessionsForComplaint(ctx.branchId, customerId) });
  });
}
