import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { approveVendorCredit } from "@/lib/purchasing/vendor-credit-service";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";

const bodySchema = z.object({
  /** Batas pakai kredit (opsional); kredit lewat tanggal ini dilewati saat dipakai. */
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

// PATCH /api/purchasing/vendor-credits/[id]/approve
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const approver = await requireIamMenuPrefix(IAM.items);
    const body = bodySchema.parse(await request.json().catch(() => ({})));

    const db = await createServerPgClient();
    const creditId = (await params).id;
    const updated = await approveVendorCredit(db, creditId, approver.id, {
      expiryDate: body.expiry_date ?? null,
    });

    await recordAuditAfterCommit({
      actor: { id: approver.id, name: approver.full_name },
      action: "vendor_credit.approve",
      entity: "vendor_credit",
      entityId: creditId,
      entityLabel: updated?.credit_number ?? null,
      after: {
        status: "approved",
        total_amount: updated?.total_amount ?? null,
        expiry_date: body.expiry_date ?? null,
      },
      ...requestMeta(request),
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: "Vendor credit approved. Purchase invoice net payable has been reduced.",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, message: "Format tanggal kedaluwarsa YYYY-MM-DD" }, { status: 400 });
    }
    console.error("Error approving vendor credit:", error);
    const message = error instanceof Error ? error.message : "Failed to approve vendor credit";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
