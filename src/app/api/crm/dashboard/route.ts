import { NextResponse } from "next/server";
import { ApiError, getPosSession } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadCrmDashboard } from "@/lib/crm/dashboard-server";

export const GET = apiHandler(async () => {
  if (!(await getPosSession())) throw ApiError.unauthorized();
  const { data, schemaReady } = await loadCrmDashboard();
  return NextResponse.json({ success: true, data, meta: { schemaReady } });
}, "crm.dashboard.GET");
