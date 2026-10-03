import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { requestMeta } from "@/lib/audit";
import { ApVoidError, voidApPayment } from "@/lib/purchasing/ap-void";

const bodySchema = z.object({ reason: z.string().max(500) });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/accounting/ap/payments/[id]/void — batalkan pembayaran AP POSTED.
 * Alasan wajib; alokasi ke invoice tidak lagi dihitung, termin PO dihitung
 * ulang, jurnal dibalik, dan aksi tercatat di audit.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    requireAccountingCompanyId(await getApiUserScope());
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());

    const result = await voidApPayment({
      paymentId: id,
      reason: body.reason,
      actor: { id: user.id, name: user.full_name },
      ...requestMeta(request),
    });

    const base = `Pembayaran ${result.payment.payment_no} di-void`;
    return NextResponse.json({
      success: true,
      data: { id: result.payment.id, payment_no: result.payment.payment_no, status: "VOID" },
      message: result.journalNote ? `${base} (${result.journalNote})` : base,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof ApVoidError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, message: "Alasan void wajib diisi" }, { status: 400 });
    }
    console.error("POST /api/accounting/ap/payments/[id]/void", error);
    return NextResponse.json({ success: false, message: "Gagal void pembayaran" }, { status: 500 });
  }
}
