import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import {
  SALES_TARGET_SETTING_KEY,
  parseSalesTarget,
  sanitizeSalesTargetInput,
} from "@/lib/dashboard/sales-target";

/**
 * GET/PUT /api/settings/sales-target — target omzet harian & bulanan
 * (EPIC-021 Fase B). Diedit dari kartu "Bulan Berjalan" dashboard eksekutif.
 */

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const config = parseSalesTarget(await getSetting(SALES_TARGET_SETTING_KEY));
  return NextResponse.json({ data: { config } });
}, "GET /api/settings/sales-target");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const body = (await request.json().catch(() => ({}))) as { harianRp?: unknown; bulananRp?: unknown };
  const sanitized = sanitizeSalesTargetInput(body);
  if (sanitized === null) throw ApiError.badRequest("Nilai target tidak valid (angka Rp, maksimal 100 M)");

  const next = { ...parseSalesTarget(await getSetting(SALES_TARGET_SETTING_KEY)), ...sanitized };
  await setSetting(SALES_TARGET_SETTING_KEY, JSON.stringify(next));
  return NextResponse.json({ data: { config: next } });
}, "PUT /api/settings/sales-target");
