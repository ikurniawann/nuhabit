import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { buildRushHourReport } from "@/lib/pos/rush-hour";
import { fetchRushHourPoints } from "@/lib/pos/rush-hour-query";

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const scope = await getApiUserScope();
    const searchParams = request.nextUrl.searchParams;
    const range = parseReportDateRange(
      searchParams.get("date_from"),
      searchParams.get("date_to")
    );
    const stallFilter = await resolveReportStallFilter(
      scope,
      searchParams.get("warehouse_id")
    );

    const empty = buildRushHourReport([]);
    const meta = {
      filters: {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        warehouse_id: stallFilter.selectedWarehouseId,
      },
      stall_options: stallFilter.stallOptions,
      stall_locked: stallFilter.stallLocked,
    };

    if (stallFilter.warehouseIds && stallFilter.warehouseIds.length === 0) {
      return NextResponse.json({ success: true, data: { ...meta, ...empty } });
    }

    const points = await fetchRushHourPoints({
      startIso: range.startIso,
      endIso: range.endIso,
      warehouseIds: stallFilter.warehouseIds,
    });
    const report = buildRushHourReport(points);

    return NextResponse.json({ success: true, data: { ...meta, ...report } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat laporan rush hour";
    const known = /tanggal|stall/i.test(message);
    console.error("[pos] rush-hour report:", error);
    return NextResponse.json(
      { success: false, error: known ? message : "Gagal memuat laporan rush hour" },
      { status: known ? 400 : 500 }
    );
  }
}
