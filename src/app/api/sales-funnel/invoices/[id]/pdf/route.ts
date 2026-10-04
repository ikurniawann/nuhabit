import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { INVOICE_VIEWER_ROLES, requireFinanceRole } from "@/lib/finance/server";
import { renderInvoicePdf, requireAccessibleInvoice } from "@/lib/sales-funnel/billing-server";

type Params = { params: Promise<{ id: string }> };

/** Unduh PDF invoice — akses via deal induk (pola PDF quotation). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;
  const { id } = await params;
  await requireAccessibleInvoice(id, user);
  const { pdf, fileName } = await renderInvoicePdf(id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}, "sales-funnel.invoices.pdf.GET");
