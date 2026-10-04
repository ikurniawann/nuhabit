import { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { completeProductStockOpname } from "@/lib/inventory/product-stock-opname-service";

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.itemsInventory);
    const { id } = await params;
    const data = await completeProductStockOpname(id, await getApiUserScope(), user.id);
    return Response.json({
      success: true,
      data,
      message: "Stock opname produk selesai dan stok telah disesuaikan",
    });
  },
  "POST /api/inventory/product-stock-opnames/[id]/complete"
);
