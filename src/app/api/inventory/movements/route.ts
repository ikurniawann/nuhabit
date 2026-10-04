import { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import {
  listMovements,
  listMovementsForExport,
  type MovementFilter,
  type MovementRow,
} from "@/lib/inventory/stock-queries";
import { MOVEMENT_TIPE_LABELS, movementReferenceLabel } from "@/lib/inventory/movement-labels";
import { parseSearchParams } from "@/lib/inventory/query-params";
import { convertToCSV, type CsvColumn } from "@/lib/utils/csv-export";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const paramsSchema = z.object({
  raw_material_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  tipe: z.enum(["in", "out", "adjustment", "transfer", "return"]).optional(),
  reference_type: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  date_from: z.string().regex(DATE).optional(),
  date_to: z.string().regex(DATE).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  format: z.enum(["json", "csv"]).default("json"),
});

const CSV_COLUMNS: CsvColumn<MovementRow>[] = [
  { key: "created_at", label: "Waktu", format: (v: string) => v.slice(0, 19) },
  { key: "material_kode", label: "Kode" },
  { key: "material_nama", label: "Bahan Baku" },
  { key: "warehouse_nama", label: "Gudang" },
  { key: "tipe", label: "Tipe", format: (v: string) => MOVEMENT_TIPE_LABELS[v] ?? v },
  { key: "jumlah", label: "Qty" },
  { key: "satuan", label: "Satuan" },
  { key: "qty_before", label: "Stok Sebelum" },
  { key: "qty_after", label: "Stok Sesudah" },
  { key: "unit_cost", label: "Biaya Satuan" },
  { key: "total_cost", label: "Total Biaya" },
  { key: "reference_type", label: "Sumber", format: (v: string | null) => movementReferenceLabel(v) },
  { key: "reference_number", label: "No. Referensi" },
  { key: "batch_numbers", label: "Batch" },
  { key: "alasan", label: "Keterangan" },
  { key: "created_by_name", label: "Oleh" },
];

/**
 * GET /api/inventory/movements — mutasi stok semua bahan baku.
 * Filter: raw_material_id, warehouse_id, tipe, reference_type, reference,
 * date_from/date_to (YYYY-MM-DD). `format=csv` mengunduh hasil filter.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const params = parseSearchParams(request.nextUrl.searchParams, paramsSchema, "Filter tidak valid", ["", "all"]);
  const filter: MovementFilter = {
    scope: await getApiUserScope(),
    rawMaterialId: params.raw_material_id,
    warehouseId: params.warehouse_id,
    tipe: params.tipe,
    referenceType: params.reference_type,
    reference: params.reference,
    dateFrom: params.date_from,
    dateTo: params.date_to,
  };

  if (params.format === "csv") {
    const csv = convertToCSV(await listMovementsForExport(filter), CSV_COLUMNS);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mutasi-stok-${stamp}.csv"`,
      },
    });
  }

  const { rows, total } = await listMovements(filter, {
    limit: params.limit,
    offset: (params.page - 1) * params.limit,
  });
  return Response.json({
    success: true,
    data: rows,
    meta: { page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit) },
  });
}, "GET /api/inventory/movements");
