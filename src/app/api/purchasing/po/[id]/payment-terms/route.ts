import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { createPoPaymentTerm, listPoPaymentTerms } from "@/lib/purchasing/po-payment-terms";
import { poPaymentTermSchema } from "@/lib/purchasing/po-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await listPoPaymentTerms(createPgClient(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.po.payment-terms.list");

export const POST = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, poPaymentTermSchema);
  const data = await createPoPaymentTerm(createPgClient(), id, input);
  return NextResponse.json(
    { success: true, data, message: "Payment term added successfully" },
    { status: 201 }
  );
}, "purchasing.po.payment-terms.create");
