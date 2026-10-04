import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { requestMeta } from "@/lib/audit";
import { ApVoidError, voidApPayment } from "@/lib/purchasing/ap-void";

const bodySchema = z.object({ reason: z.string().max(500, "Alasan void maksimal 500 karakter") });

/**
 * POST /api/accounting/ap/payments/[id]/void — batalkan pembayaran AP POSTED.
 * Alasan wajib; alokasi ke invoice tidak lagi dihitung, termin PO dihitung
 * ulang, jurnal dibalik, dan aksi tercatat di audit.
 */
export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.accounting);
    requireAccountingCompanyId(await getApiUserScope());
    const { id } = await params;
    const body = await validateBody(request, bodySchema);

    const result = await voidApPayment({
      paymentId: id,
      reason: body.reason,
      actor: { id: user.id, name: user.full_name },
      ...requestMeta(request),
    }).catch((error: unknown) => {
      if (error instanceof ApVoidError) throw new ApiError(error.status, error.message);
      throw error;
    });

    const base = `Pembayaran ${result.payment.payment_no} di-void`;
    return NextResponse.json({
      success: true,
      data: { id: result.payment.id, payment_no: result.payment.payment_no, status: "VOID" },
      message: result.journalNote ? `${base} (${result.journalNote})` : base,
    });
  },
  "POST /api/accounting/ap/payments/[id]/void"
);
