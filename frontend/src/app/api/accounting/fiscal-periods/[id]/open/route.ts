import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { assertFiscalPeriodInScope, openFiscalPeriodById } from "@/lib/accounting/fiscal";

const bodySchema = z.object({
  close_previous: z.boolean().optional().default(true),
});

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    // Body opsional: request tanpa body tetap valid.
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message || "Validasi gagal");
    }
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    await assertFiscalPeriodInScope(id, scope);

    const data = await openFiscalPeriodById({
      periodId: id,
      userId: user.id,
      companyId,
      closePrevious: parsed.data.close_previous,
    });
    return NextResponse.json({ data, message: `Period ${data.name} berhasil dibuka` });
  },
  "POST /api/accounting/fiscal-periods/[id]/open"
);
