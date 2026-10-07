import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { wibDateString } from "@/lib/pos/report-period";
import { loadFrontOfficeBoard } from "@/lib/resort/front-desk-server";
import { requireResortContext } from "@/lib/resort/server";

/**
 * GET /api/resort/front-office?date=YYYY-MM-DD — papan kerja harian:
 * kedatangan, keberangkatan, tamu menginap, okupansi, dan status kamar.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext();
  const raw = request.nextUrl.searchParams.get("date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : wibDateString(new Date());
  return NextResponse.json({ success: true, data: await loadFrontOfficeBoard(ctx.branchId, date) });
}, "resort.front-office.GET");
