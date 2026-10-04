import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleAccount } from "@/lib/sales-funnel/access";
import { updateAccountSchema } from "@/lib/sales-funnel/accounts";
import { deleteAccount, getAccountDetail, updateAccount } from "@/lib/sales-funnel/accounts-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Account 360° (EPIC-050 T-1.3). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleAccount(id, user);
  return successResponse(await getAccountDetail(id));
}, "sales-funnel.accounts.detail.GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const account = await requireAccessibleAccount(id, user);
  const body = await validateBody(request, updateAccountSchema);
  return successResponse(await updateAccount(user, account, body), "Account diperbarui");
}, "sales-funnel.accounts.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleAccount(id, user);
  await deleteAccount(id);
  return noContentResponse();
}, "sales-funnel.accounts.DELETE");
