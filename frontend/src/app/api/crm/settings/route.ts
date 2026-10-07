import { NextRequest, NextResponse } from "next/server";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { crmSettingsUpdateSchema, readCrmSettings, updateCrmSettings } from "@/lib/crm/settings-server";

export const GET = apiHandler(async () => {
  if (!(await getPosSession())) throw ApiError.unauthorized();
  const settings = await readCrmSettings();
  if (!settings) return NextResponse.json({ success: true, data: {}, meta: { schemaReady: false } });
  return NextResponse.json({ success: true, data: settings, meta: { schemaReady: true } });
}, "crm.settings.GET");

export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("settings");
  const payload = await validateBody(request, crmSettingsUpdateSchema);
  await updateCrmSettings(payload, user.id);
  return NextResponse.json({ success: true });
}, "crm.settings.PUT");
