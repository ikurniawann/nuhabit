import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApInvoiceById } from "@/lib/accounting/ap-store";

export const GET = apiHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const row = await getApInvoiceById(id);
    if (!row) throw ApiError.notFound("AP invoice tidak ditemukan");
    return NextResponse.json({ success: true, data: row });
  },
  "GET /api/accounting/ap/invoices/[id]"
);
