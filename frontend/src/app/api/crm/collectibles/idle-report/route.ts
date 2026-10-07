import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadIdleEntitlementReport } from "@/lib/crm/collectibles-admin-server";
import { requireCrmUser } from "@/lib/crm/guards";

/** Laporan "jatah menganggur" (EPIC-014 Task 2) — member dengan jatah collectible belum terpakai. */
export const GET = apiHandler(async () => {
  await requireCrmUser("reports");
  return NextResponse.json({ success: true, data: await loadIdleEntitlementReport() });
}, "crm.collectibles.idle-report.GET");
