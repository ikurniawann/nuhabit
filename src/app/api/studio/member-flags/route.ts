import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { addBackofficeFlag, backofficeFlagSummary, listFlagTypes } from "@/lib/studio/member-flags-server";
import { backofficeMemberFlagSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MENU = ["studio.member-flags"] as const;

/**
 * Member perhatian khusus (EPIC-067 T-067-C1). Penanda medis hanya berupa
 * jumlah — detailnya khusus coach (Coach Portal). ?customer_id= untuk satu member.
 */
export async function GET(request: NextRequest) {
  return studioRoute("member-flags GET", async () => {
    const ctx = await requireStudioContext(undefined, MENU);
    const customerId = request.nextUrl.searchParams.get("customer_id");
    const [types, members] = await Promise.all([
      listFlagTypes(true),
      backofficeFlagSummary(ctx.branchId, customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? customerId : undefined),
    ]);
    return NextResponse.json({ success: true, data: { types, members } });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("member-flags POST", async () => {
    const ctx = await requireStudioContext("create", MENU);
    const b = await validateBody(request, backofficeMemberFlagSchema);
    const id = await addBackofficeFlag(ctx, ctx.user.id, b.customer_id, b);
    return NextResponse.json({ success: true, data: { id }, message: "Penanda ditambahkan" }, { status: 201 });
  });
}
