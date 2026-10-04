import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { parseReportQuery } from "@/lib/purchasing/report-query";
import { getStockCard, stockCardQuerySchema } from "@/lib/purchasing/report-stock-card";

// GET /api/purchasing/reports/stock-card
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const parsed = parseReportQuery(request, stockCardQuerySchema);
  // Filter gudang eksplisit menang; selain itu ikut stall aktif di sidebar.
  const params = {
    ...parsed,
    warehouse_id: (await resolveWarehouseFilter(parsed.warehouse_id)) ?? undefined,
  };
  const data = await getStockCard(createPgClient(), params);
  return NextResponse.json({ success: true, data: { item_type: params.item_type, ...data } });
}, "purchasing.reports.stock-card");
