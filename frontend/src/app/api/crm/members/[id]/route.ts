import { NextRequest, NextResponse } from "next/server";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadMemberDetail, updateMemberDetail, updateMemberSchema } from "@/lib/crm/member-profile-server";

type Ctx = { params: Promise<{ id: string }> };

async function requireSession() {
  if (!(await getPosSession())) throw ApiError.unauthorized();
}

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireSession();
  const data = await loadMemberDetail((await params).id);
  return NextResponse.json({ success: true, data, meta: { schemaReady: true } });
}, "crm.members.[id].GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  await requireSession();
  const payload = await validateBody(request, updateMemberSchema);
  const data = await updateMemberDetail((await params).id, payload);
  return NextResponse.json({ success: true, data, meta: { schemaReady: true } });
}, "crm.members.[id].PATCH");
