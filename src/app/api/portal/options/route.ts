import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getPortalOptions } from "@/lib/recruitment/portal-application";

/**
 * GET /api/portal/options[?opening=<uuid>]: endpoint PUBLIK form lamaran.
 * Outlet & posisi aktif plus auto-fill dari job opening; hanya data yang
 * memang tampil publik di halaman karir.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const data = await getPortalOptions(request.nextUrl.searchParams.get("opening"));
  return NextResponse.json({ data });
}, "portal/options");
