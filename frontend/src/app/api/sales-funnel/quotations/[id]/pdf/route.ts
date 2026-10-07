import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { renderQuotationPdf, requireAccessibleQuotation } from "@/lib/sales-funnel/quotations-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Unduh PDF quotation (EPIC-022 Fase F2) — akses via deal induk. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleQuotation(id, user);
  const { pdf, fileName } = await renderQuotationPdf(id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}, "sales-funnel.quotations.pdf.GET");
