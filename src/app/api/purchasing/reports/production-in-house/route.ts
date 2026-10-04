import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  EMPTY_PRODUCTION_REPORT,
  buildProductionInHouseReport,
  loadProductWarehouses,
  loadProductionOrders,
  loadWarehouseProductIds,
  productionInHouseCsvRows,
  productionInHouseQuerySchema,
} from "@/lib/purchasing/report-production-in-house";
import { csvResponse, parseReportQuery, quotedCsv } from "@/lib/purchasing/report-query";

// GET /api/purchasing/reports/production-in-house
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const params = parseReportQuery(request, productionInHouseQuerySchema);

  const warehouseProductIds = await loadWarehouseProductIds(db, params.warehouse_id);
  // Gudang tanpa produk aktif: selalu JSON kosong, juga untuk export=csv (perilaku lama).
  if (warehouseProductIds?.length === 0) return successResponse(EMPTY_PRODUCTION_REPORT);

  const rows = await loadProductionOrders(db, params, warehouseProductIds);
  const productIds = Array.from(
    new Set(rows.map((row) => row.product_id).filter((id): id is string => Boolean(id)))
  );
  const report = buildProductionInHouseReport(rows, await loadProductWarehouses(db, productIds));

  if (params.export === "csv") {
    const { header, rows: csvRows } = productionInHouseCsvRows(report.orders);
    return csvResponse(quotedCsv(header, csvRows), "production-in-house");
  }
  return successResponse(report);
}, "purchasing.reports.production-in-house");
