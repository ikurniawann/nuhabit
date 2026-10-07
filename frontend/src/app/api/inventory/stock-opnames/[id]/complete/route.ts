import { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { requestMeta } from "@/lib/audit";
import { completeStockOpname } from "@/lib/inventory/stock-opname-service";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.itemsInventory);
    const { id } = await params;
    const { data, accountingNote } = await completeStockOpname(id, user, requestMeta(request), await getApiUserScope());
    const baseMessage = "Stock opname selesai dan stok telah disesuaikan";
    return Response.json({
      success: true,
      data,
      message: accountingNote ? `${baseMessage} (${accountingNote})` : baseMessage,
      accounting_note: accountingNote,
    });
  },
  "POST /api/inventory/stock-opnames/[id]/complete"
);
