import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const { id } = await params;
    const sp = request.nextUrl.searchParams;
    const page = Number(sp.get("page") || 1);
    const limit = Number(sp.get("limit") || 25);
    const offset = (page - 1) * limit;

    const { data, error, count } = await createPgClient()
      .from("inventory_movements")
      .select("*", { count: "exact" })
      .eq("inventory_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return paginatedResponse(data || [], { page, limit, total: count || 0 }, "Movements retrieved");
  },
  "GET /api/inventory/[id]/movements"
);
