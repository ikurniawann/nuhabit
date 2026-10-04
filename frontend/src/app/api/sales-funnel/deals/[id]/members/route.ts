import { NextRequest } from "next/server";
import { ApiError, createdResponse, noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  addDealMember,
  addDealMemberSchema,
  listDealMembers,
  removeDealMember,
} from "@/lib/sales-funnel/deals-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** EPIC-050 T-3.1 — deal team: banyak orang per deal. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleDeal(id, user);
  return successResponse(await listDealMembers(id));
}, "sales-funnel.deals.members.GET");

export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const deal = await requireAccessibleDeal(id, user);
  const body = await validateBody(request, addDealMemberSchema);
  return createdResponse(await addDealMember(deal, body, user.id), "Anggota tim ditambahkan");
}, "sales-funnel.deals.members.POST");

export const DELETE = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleDeal(id, user);
  const memberId = request.nextUrl.searchParams.get("member_id");
  if (!memberId) throw ApiError.badRequest("member_id wajib");
  await removeDealMember(id, memberId);
  return noContentResponse();
}, "sales-funnel.deals.members.DELETE");
