import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { convertPrToPo, prConvertSchema } from "@/lib/purchasing/pr-convert";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const user = await requireIamMenuPrefix(IAM.items);
    const input = await validateBody(request, prConvertSchema);
    const data = await convertPrToPo(createPgClient(), id, input, user.id, await getApiUserScope());
    return NextResponse.json(
      { success: true, data, message: "PR berhasil dikonversi menjadi PO" },
      { status: 201 }
    );
  },
  "purchasing.pr.convert-to-po"
);
