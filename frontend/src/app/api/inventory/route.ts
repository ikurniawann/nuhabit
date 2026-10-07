import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const sp = request.nextUrl.searchParams;
  const search = sp.get("search") || "";
  const status = sp.get("status") || "";
  const page = Number(sp.get("page") || 1);
  const limit = Number(sp.get("limit") || 20);
  const offset = (page - 1) * limit;

  let query = createPgClient()
    .from("v_inventory")
    .select("*", { count: "exact" })
    .order("material_nama", { ascending: true })
    .range(offset, offset + limit - 1);
  if (search) query = query.or(`material_nama.ilike.%${search}%,material_kode.ilike.%${search}%`);
  if (status) query = query.eq("stock_status", status);

  const { data, error, count } = await query;
  if (error) throw error;
  return paginatedResponse(data || [], { page, limit, total: count || 0 }, "Inventory retrieved");
}, "GET /api/inventory");
