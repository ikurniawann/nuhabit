import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  createArInvoiceFromSalesInvoice,
  getArInvoiceBySalesInvoiceId,
} from "@/lib/accounting/ar-store";

export const GET = apiHandler(
  async (_request: Request, { params }: { params: Promise<{ salesInvoiceId: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { salesInvoiceId } = await params;
    let row = await getArInvoiceBySalesInvoiceId(salesInvoiceId);
    if (!row) {
      // Buat AR on-demand; invoice yang tidak memenuhi syarat dibiarkan 404.
      row = await createArInvoiceFromSalesInvoice({ salesInvoiceId, userId: user.id })
        .then((created) => created.invoice)
        .catch(() => null);
    }
    if (!row) throw ApiError.notFound("AR invoice tidak ditemukan untuk B2B ini");
    return NextResponse.json({ success: true, data: row });
  },
  "GET /api/accounting/ar/by-sales-invoice/[salesInvoiceId]"
);
