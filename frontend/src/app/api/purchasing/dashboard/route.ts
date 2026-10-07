import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { loadPurchasingDashboard } from "@/lib/purchasing/dashboard-data";

// GET /api/purchasing/dashboard: bentuk respons = PurchasingDashboardData
// (src/features/purchasing/dashboard/queries.ts).
export const GET = apiHandler(async (request: Request) => {
  await requireIamMenuPrefix(IAM.items);
  const { searchParams } = new URL(request.url);
  const data = await loadPurchasingDashboard(
    await createServerPgClient(),
    searchParams.get("start_date"),
    searchParams.get("end_date")
  );
  return NextResponse.json(data);
}, "purchasing.dashboard");
