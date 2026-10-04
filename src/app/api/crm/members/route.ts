import { NextRequest, NextResponse } from "next/server";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { enrollMember, enrollMemberSchema, listMembers } from "@/lib/crm/member-directory-server";

async function requireSession() {
  if (!(await getPosSession())) throw ApiError.unauthorized();
}

export const GET = apiHandler(async (request: NextRequest) => {
  await requireSession();
  const params = request.nextUrl.searchParams;
  const { data, schemaReady } = await listMembers({
    search: params.get("search"),
    tier: params.get("tier"),
    limit: params.get("limit"),
  });
  return NextResponse.json({ success: true, data, meta: { schemaReady } });
}, "crm.members.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireSession();
  const payload = await validateBody(request, enrollMemberSchema);
  return NextResponse.json({ success: true, data: await enrollMember(payload) });
}, "crm.members.POST");
