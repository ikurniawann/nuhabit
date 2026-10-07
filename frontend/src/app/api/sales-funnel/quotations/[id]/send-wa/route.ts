import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleQuotation, sendQuotationWa } from "@/lib/sales-funnel/quotations-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Kirim ringkasan quotation sebagai teks WA ke PIC (EPIC-022 Fase F2). */
export const POST = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const { deal } = await requireAccessibleQuotation(id, user);
  const { messageId, picName } = await sendQuotationWa(user, deal, id);
  return successResponse({ message_id: messageId }, `Quotation terkirim ke ${picName}`);
}, "sales-funnel.quotations.send-wa.POST");
