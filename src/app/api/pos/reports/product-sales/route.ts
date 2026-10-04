import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { posReportXlsxResponse } from "@/lib/pos/report-xlsx";
import {
  buildProductSalesExportSheets,
  productSalesExportFileName,
} from "@/lib/pos/reports/product-sales-export";

type ProductSalesRow = {
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  warehouse_id: string | null;
  stall_code: string | null;
  stall_name: string | null;
  quantity: number | string | null;
  revenue: number | string | null;
  order_count: number | string | null;
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const scope = await getApiUserScope();
    const searchParams = request.nextUrl.searchParams;
    const wantsXlsx = searchParams.get("format") === "xlsx";
    const range = parseReportDateRange(
      searchParams.get("date_from"),
      searchParams.get("date_to")
    );
    const stallFilter = await resolveReportStallFilter(
      scope,
      searchParams.get("warehouse_id")
    );

    if (stallFilter.warehouseIds && stallFilter.warehouseIds.length === 0) {
      const empty = {
        filters: {
          date_from: range.dateFrom,
          date_to: range.dateTo,
          warehouse_id: stallFilter.selectedWarehouseId,
        },
        stall_options: stallFilter.stallOptions,
        stall_locked: stallFilter.stallLocked,
        summary: {
          products: 0,
          quantity: 0,
          revenue: 0,
        },
        rows: [],
      };
      if (wantsXlsx) {
        return posReportXlsxResponse(
          buildProductSalesExportSheets(empty),
          productSalesExportFileName(empty.filters)
        );
      }
      return NextResponse.json({
        success: true,
        data: empty,
      });
    }

    // Omzet = pos_orders + items only. Do not join pos_checkouts totals.
    const rows = await query<ProductSalesRow>(
      `SELECT
         i.product_id,
         COALESCE(MAX(i.product_name), MAX(pp.name), 'Unknown') AS product_name,
         -- SKU: utamakan kode master (mis. MM-STALL-02-005) — snapshot
         -- i.product_sku berisi UUID/"SKU-{uuid}" lama yang salah tampil.
         COALESCE(MAX(p.kode), MAX(pp.sku), MAX(i.product_sku)) AS product_sku,
         p.warehouse_id,
         MAX(w.code) AS stall_code,
         MAX(w.name) AS stall_name,
         SUM(COALESCE(i.quantity, 0)) AS quantity,
         SUM(COALESCE(i.total_amount, 0)) AS revenue,
         COUNT(DISTINCT o.id) AS order_count
       FROM pos.pos_orders o
       INNER JOIN pos.pos_order_items i ON i.order_id = o.id
       LEFT JOIN pos.pos_products pp ON pp.id = i.product_id
       LEFT JOIN item.products p ON p.id = pp.source_product_id
       LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
       WHERE o.ordered_at >= $1::timestamptz
         AND o.ordered_at <= $2::timestamptz
         AND o.status NOT IN ('cancelled', 'voided', 'merged')
         AND (o.payment_status = 'paid' OR o.status = 'completed')
         AND (
           $3::uuid[] IS NULL
           OR p.warehouse_id = ANY($3::uuid[])
         )
       GROUP BY i.product_id, p.warehouse_id
       ORDER BY SUM(COALESCE(i.total_amount, 0)) DESC, COALESCE(MAX(i.product_name), '') ASC`,
      [range.startIso, range.endIso, stallFilter.warehouseIds]
    );

    const mapped = rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name || "Unknown",
      product_sku: row.product_sku,
      warehouse_id: row.warehouse_id,
      stall_code: row.stall_code,
      stall_name: row.stall_name,
      quantity: toNumber(row.quantity),
      revenue: Math.round(toNumber(row.revenue) * 100) / 100,
      order_count: toNumber(row.order_count),
    }));

    const summary = mapped.reduce(
      (acc, row) => {
        acc.products += 1;
        acc.quantity += row.quantity;
        acc.revenue += row.revenue;
        return acc;
      },
      { products: 0, quantity: 0, revenue: 0 }
    );

    const data = {
      filters: {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        warehouse_id: stallFilter.selectedWarehouseId,
      },
      stall_options: stallFilter.stallOptions,
      stall_locked: stallFilter.stallLocked,
      summary: {
        products: summary.products,
        quantity: summary.quantity,
        revenue: Math.round(summary.revenue * 100) / 100,
      },
      rows: mapped,
    };

    if (wantsXlsx) {
      return posReportXlsxResponse(
        buildProductSalesExportSheets(data),
        productSalesExportFileName(data.filters)
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    console.error("Error fetching POS product sales report:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
