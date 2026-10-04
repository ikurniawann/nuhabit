import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  buildInventoryValuation,
  loadValuationStock,
} from "@/lib/purchasing/report-inventory-valuation";

// GET /api/purchasing/reports/inventory-valuation
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const rows = await loadValuationStock(await createServerPgClient());
  return NextResponse.json({ success: true, ...buildInventoryValuation(rows) });
}, "purchasing.reports.inventory-valuation");
