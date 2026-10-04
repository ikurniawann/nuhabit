import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  deleteQuotation,
  requireAccessibleQuotation,
  updateQuotation,
  updateQuotationSchema,
} from "@/lib/sales-funnel/quotations-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const { row } = await requireAccessibleQuotation(id, user);
  const body = await validateBody(request, updateQuotationSchema);
  return successResponse(await updateQuotation(user, row, body), "Quotation diperbarui");
}, "sales-funnel.quotations.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const { row } = await requireAccessibleQuotation(id, user);
  await deleteQuotation(row);
  return noContentResponse();
}, "sales-funnel.quotations.DELETE");
