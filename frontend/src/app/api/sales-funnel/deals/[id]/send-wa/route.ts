import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import { sendDealWa, sendDealWaSchema } from "@/lib/sales-funnel/deals-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Kirim cepat WA ke PIC deal via gateway (EPIC-022 Fase C), dicatat sebagai aktivitas `wa`. */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const deal = await requireAccessibleDeal(id, user);
  const body = await validateBody(request, sendDealWaSchema);
  const { messageId, picName } = await sendDealWa(user, deal, body);
  return successResponse({ message_id: messageId }, `Pesan terkirim ke ${picName}`);
}, "sales-funnel.deals.send-wa.POST");
