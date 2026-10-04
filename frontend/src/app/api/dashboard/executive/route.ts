import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { buildExecutiveDashboard, type ExecutiveDashboard } from "@/lib/dashboard/executive";
import { getSetting } from "@/lib/settings/app-settings";
import {
  SALES_TARGET_SETTING_KEY,
  parseSalesTarget,
  type SalesTargetConfig,
} from "@/lib/dashboard/sales-target";

/**
 * GET /api/dashboard/executive — data dashboard eksekutif (EPIC-021).
 * Cache in-memory 60 dtk; hasil yang memuat seksi gagal tidak di-cache.
 */

const CACHE_TTL_MS = 60_000;
let cached: { at: number; data: ExecutiveDashboard; target: SalesTargetConfig } | null = null;

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.dashboard);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ data: cached.data, target: cached.target, cached: true });
  }

  const [data, target] = await Promise.all([
    buildExecutiveDashboard(),
    getSetting(SALES_TARGET_SETTING_KEY).then(parseSalesTarget),
  ]);
  if (data.gagal.length === 0) cached = { at: Date.now(), data, target };
  return NextResponse.json({ data, target, cached: false });
}, "GET /api/dashboard/executive");
