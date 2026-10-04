import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { revisePurchaseRequest } from "@/lib/purchasing/pr-workflow";

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();
    const data = await revisePurchaseRequest(db, id, user);
    return NextResponse.json({ data }, { status: 201 });
  },
  "purchasing.pr.revise"
);
