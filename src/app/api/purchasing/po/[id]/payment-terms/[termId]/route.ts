import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { cancelPoPaymentTerm } from "@/lib/purchasing/po-payment-terms";

export const DELETE = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string; termId: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id, termId } = await params;
    await cancelPoPaymentTerm(createPgClient(), id, termId);
    return NextResponse.json({ success: true, message: "Termin pembayaran berhasil dihapus" });
  },
  "purchasing.po.payment-terms.cancel"
);
