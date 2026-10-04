import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { readJson } from "@/lib/hris/workforce-route";
import {
  departmentConfigSchema,
  loadDepartmentConfig,
  requireKpiManager,
  saveDepartmentConfig,
} from "@/lib/kpi/department-config";

/** GET: departemen, indikator aktif, dan pemetaan departemen → indikator. */
export const GET = apiHandler(async () => {
  await requireKpiManager();
  return NextResponse.json({ data: await loadDepartmentConfig() });
}, "hris/kpi-config.GET");

/** PUT { department_id, items: [{ indicator_id, enabled, weight }] } */
export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireKpiManager();
  const input = await readJson(request, departmentConfigSchema);
  const departmentName = await saveDepartmentConfig(user.full_name || "Pengelola KPI", input);
  return NextResponse.json({
    message: `Konfigurasi KPI departemen ${departmentName} disimpan — berlaku mulai snapshot bulan berikutnya`,
  });
}, "hris/kpi-config.PUT");
