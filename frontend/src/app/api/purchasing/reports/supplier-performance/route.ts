import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { csvResponse, parseReportQuery } from "@/lib/purchasing/report-query";
import {
  loadActiveSuppliers,
  loadSupplierPerformanceSources,
  rankSupplierPerformance,
  supplierPerformanceCsv,
  supplierPerformanceQuerySchema,
  supplierPerformanceSummary,
} from "@/lib/purchasing/report-supplier-performance";

// GET /api/purchasing/reports/supplier-performance
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const params = parseReportQuery(request, supplierPerformanceQuerySchema);

  const suppliers = await loadActiveSuppliers(db, params.supplier_id);
  // Tanpa supplier: selalu JSON kosong, juga untuk export=csv (perilaku lama).
  if (suppliers.length === 0) {
    return successResponse({
      summary: {
        total_suppliers: 0,
        period: { from: params.date_from, to: params.date_to },
        top_supplier: null,
        total_spend_all_suppliers: 0,
      },
      vendors: [],
      suppliers: [],
    });
  }

  const ranked = rankSupplierPerformance(await loadSupplierPerformanceSources(db, suppliers, params));
  if (params.export === "csv") return csvResponse(supplierPerformanceCsv(ranked), "supplier-performance");
  return successResponse(supplierPerformanceSummary(ranked, params));
}, "purchasing.reports.supplier-performance");
