import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { userHasIamAction } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getPurchaseRequestDetail } from "@/lib/purchasing/pr-queries";
import { updatePurchaseRequest } from "@/lib/purchasing/pr-workflow";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const hasApprovalGrant = await userHasIamAction(user.id, user.role, IAM.itemsPrApproval, "update");
  const data = await getPurchaseRequestDetail(db, id, user, hasApprovalGrant);
  return NextResponse.json({ data });
}, "purchasing.pr.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const data = await updatePurchaseRequest(db, id, await request.json(), user);
  return NextResponse.json({ data });
}, "purchasing.pr.update");
