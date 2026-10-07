import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { clampExpiringDays, loadExpiringContracts } from "@/lib/hris/contracts-repo";

/**
 * GET /api/hris/contracts/expiring?days=30 — kontrak/masa percobaan yang
 * akan berakhir dan karyawan aktif tanpa kontrak aktif. Dipakai banner di
 * direktori Karyawan & halaman HRIS → Kontrak.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const days = clampExpiringDays(req.nextUrl.searchParams.get("days"));
  return NextResponse.json({ data: await loadExpiringContracts(days) });
}, "hris/contracts/expiring GET");
