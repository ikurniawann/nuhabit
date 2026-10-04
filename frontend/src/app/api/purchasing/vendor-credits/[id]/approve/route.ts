import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { approveVendorCredit } from "@/lib/purchasing/vendor-credit-service";

const bodySchema = z.object({
  /** Batas pakai kredit (opsional); kredit lewat tanggal ini dilewati saat dipakai. */
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const approver = await requireIamMenuPrefix(IAM.items);
    // Body opsional: tanpa body = tanpa tanggal kedaluwarsa.
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw ApiError.badRequest("Format tanggal kedaluwarsa YYYY-MM-DD");
    const expiryDate = parsed.data.expiry_date ?? null;

    const creditId = (await params).id;
    const updated = await approveVendorCredit(await createServerPgClient(), creditId, approver.id, {
      expiryDate,
    });

    await recordAuditAfterCommit({
      actor: { id: approver.id, name: approver.full_name },
      action: "vendor_credit.approve",
      entity: "vendor_credit",
      entityId: creditId,
      entityLabel: updated?.credit_number ?? null,
      after: { status: "approved", total_amount: updated?.total_amount ?? null, expiry_date: expiryDate },
      ...requestMeta(request),
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: "Vendor credit approved. Purchase invoice net payable has been reduced.",
    });
  },
  "purchasing.vendor-credits.approve"
);
