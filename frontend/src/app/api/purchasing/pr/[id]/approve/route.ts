import { NextRequest, NextResponse } from "next/server";
import { requireIamAction, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { decidePurchaseRequest, prDecisionSchema } from "@/lib/purchasing/pr-workflow";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamAction(IAM.itemsPrApproval, "update");
    const { id } = await params;
    const db = await createServerPgClient();
    const decision = await validateBody(request, prDecisionSchema);
    const data = await decidePurchaseRequest(db, id, decision, user, getApiUserScope);
    return NextResponse.json({ data });
  },
  "purchasing.pr.approve"
);
