import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { posReportXlsxResponse } from "@/lib/pos/report-xlsx";
import { summarizeSales } from "@/lib/pos/sales-summary";
import {
  buildTransactionExportSheets,
  transactionExportFileName,
} from "@/lib/pos/reports/transaction-export";

type TransactionRow = {
  id: string;
  order_number: string | null;
  ordered_at: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_method_code: string | null;
  payment_method_name: string | null;
  subtotal: number | string | null;
  discount_amount: number | string | null;
  tax_amount: number | string | null;
  service_charge_amount: number | string | null;
  total_amount: number | string | null;
  ark_coins_used: number | string | null;
  cashier_id: string | null;
  warehouse_id: string | null;
  stall_code: string | null;
  stall_name: string | null;
  checkout_id: string | null;
  checkout_number: string | null;
  sold_from: string | null;
  xendit_qr_id: string | null;
  xendit_external_id: string | null;
  /** Tanggal WIB (YYYY-MM-DD) — dihitung DB supaya konsisten dengan filter. */
  hari_wib: string;
  comp_type?: string | null;
  comp_approved_name?: string | null;
};

type TopProductRow = {
  product_name: string;
  quantity: number | string;
  revenue: number | string;
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
          transactions: 0,
          total_sales: 0,
          total_ark_used: 0,
          revenue: 0,
          discount: 0,
          tax: 0,
          service: 0,
          nett: 0,
        },
        per_stall: [],
        top_products: [],
        daily: [],
        rows: [],
      };
      if (wantsXlsx) {
        return posReportXlsxResponse(
          buildTransactionExportSheets(empty),
          transactionExportFileName(empty.filters)
        );
      }
      return NextResponse.json({
        success: true,
        data: empty,
      });
    }

    const rows = await query<TransactionRow>(
      `SELECT
         o.id,
         o.order_number,
         o.ordered_at,
         o.status,
         o.payment_status,
         o.payment_method,
         o.payment_method_code,
         o.payment_method_name,
         o.subtotal,
         o.discount_amount,
         o.tax_amount,
         o.service_charge_amount,
         o.total_amount,
         o.ark_coins_used,
         o.cashier_id,
         (o.ordered_at AT TIME ZONE 'Asia/Jakarta')::date::text AS hari_wib,
         COALESCE(o.warehouse_id, stall_from_item.warehouse_id) AS warehouse_id,
         COALESCE(w_order.code, stall_from_item.stall_code) AS stall_code,
         COALESCE(w_order.name, stall_from_item.stall_name) AS stall_name,
         o.checkout_id,
         o.sold_from,
         (to_jsonb(o) ->> 'comp_type') AS comp_type,
         (to_jsonb(o) ->> 'comp_approved_name') AS comp_approved_name,
         chk.checkout_number,
         COALESCE(o.xendit_qr_id, chk.xendit_qr_id) AS xendit_qr_id,
         COALESCE(o.xendit_external_id, chk.xendit_external_id) AS xendit_external_id
       FROM pos.pos_orders o
       LEFT JOIN pos.pos_checkouts chk ON chk.id = o.checkout_id
       LEFT JOIN configuration.warehouses w_order ON w_order.id = o.warehouse_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(p.warehouse_id, p_sku.warehouse_id) AS warehouse_id,
           COALESCE(w.code, w_sku.code) AS stall_code,
           COALESCE(w.name, w_sku.name) AS stall_name
         FROM pos.pos_order_items i
         INNER JOIN pos.pos_products pp ON pp.id = i.product_id
         LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
         LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
         LEFT JOIN item.products p_sku
           ON pp.source_product_id IS NULL
          AND pp.sku = ('PUR-' || p_sku.kode)
          AND p_sku.deleted_at IS NULL
          AND p_sku.kode IS NOT NULL
          AND btrim(p_sku.kode) <> ''
         LEFT JOIN configuration.warehouses w_sku ON w_sku.id = p_sku.warehouse_id
         WHERE i.order_id = o.id
         ORDER BY COALESCE(i.total_amount, 0) DESC, i.id
         LIMIT 1
       ) stall_from_item ON o.warehouse_id IS NULL
       WHERE o.ordered_at >= $1::timestamptz
         AND o.ordered_at <= $2::timestamptz
         AND o.status NOT IN ('cancelled', 'voided', 'merged')
         AND (o.payment_status = 'paid' OR o.status = 'completed')
         AND (
           $3::uuid[] IS NULL
           OR o.warehouse_id = ANY($3::uuid[])
           OR (
             o.warehouse_id IS NULL
             AND stall_from_item.warehouse_id = ANY($3::uuid[])
           )
         )
       ORDER BY o.ordered_at DESC NULLS LAST`,
      [range.startIso, range.endIso, stallFilter.warehouseIds]
    );

    // Setiap baris pos_orders = pendapatan stall; total pos_checkouts tidak pernah ditambahkan.
    const revenueRows = rows;
    const summary = summarizeSales(revenueRows);

    // Tren harian (hari WIB): nett + jumlah transaksi per tanggal — bahan
    // grafik tren di halaman laporan.
    const dailyMap = new Map<string, { nett: number; transactions: number }>();
    for (const row of revenueRows) {
      const bucket = dailyMap.get(row.hari_wib) ?? { nett: 0, transactions: 0 };
      bucket.nett += toNumber(row.total_amount);
      bucket.transactions += 1;
      dailyMap.set(row.hari_wib, bucket);
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, v]) => ({
        date,
        nett: Math.round(v.nett * 100) / 100,
        transactions: v.transactions,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top produk pada rentang & stall yang SAMA dengan daftar transaksi —
    // satu sumber filter, supaya angka antar-bagian laporan tidak berselisih.
    const orderIds = revenueRows.map((row) => row.id);

    // Rekap per stall berbasis ITEM: order lintas stall (mode Semua Stall,
    // warehouse_id order null) menyumbang ke tiap stall sesuai itemnya.
    let perStall: Array<{
      stall_code: string | null;
      stall_name: string;
      transactions: number;
      quantity: number;
      sales: number;
    }> = [];
    if (orderIds.length > 0) {
      const stallRows = await query<{
        stall_code: string | null;
        stall_name: string | null;
        transactions: string | number;
        quantity: string | number;
        sales: string | number;
      }>(
        `SELECT COALESCE(w.code, w_sku.code) AS stall_code,
                COALESCE(w.name, w_sku.name) AS stall_name,
                COUNT(DISTINCT i.order_id) AS transactions,
                SUM(i.quantity)::float8 AS quantity,
                SUM(i.total_amount)::float8 AS sales
           FROM pos.pos_order_items i
           INNER JOIN pos.pos_products pp ON pp.id = i.product_id
           LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
           LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
           LEFT JOIN item.products p_sku
             ON pp.source_product_id IS NULL
            AND pp.sku = ('PUR-' || p_sku.kode)
            AND p_sku.deleted_at IS NULL
            AND p_sku.kode IS NOT NULL
            AND btrim(p_sku.kode) <> ''
           LEFT JOIN configuration.warehouses w_sku ON w_sku.id = p_sku.warehouse_id
          WHERE i.order_id = ANY($1::uuid[])
          GROUP BY 1, 2
          ORDER BY SUM(i.total_amount) DESC`,
        [orderIds]
      );
      perStall = stallRows.map((row) => ({
        stall_code: row.stall_code,
        stall_name: row.stall_name ?? "Tanpa Stall",
        transactions: toNumber(row.transactions),
        quantity: Math.round(toNumber(row.quantity) * 100) / 100,
        sales: Math.round(toNumber(row.sales) * 100) / 100,
      }));
    }

    let topProducts: Array<{ product_name: string; quantity: number; revenue: number }> = [];
    if (orderIds.length > 0) {
      const topRows = await query<TopProductRow>(
        `SELECT COALESCE(i.product_name, 'Tanpa Nama') AS product_name,
                SUM(i.quantity)::float8 AS quantity,
                SUM(i.total_amount)::float8 AS revenue
           FROM pos.pos_order_items i
          WHERE i.order_id = ANY($1::uuid[])
          GROUP BY 1
          ORDER BY SUM(i.total_amount) DESC
          LIMIT 50`,
        [orderIds]
      );
      topProducts = topRows.map((row) => ({
        product_name: row.product_name,
        quantity: Math.round(toNumber(row.quantity) * 100) / 100,
        revenue: Math.round(toNumber(row.revenue) * 100) / 100,
      }));
    }

    const data = {
      filters: {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        warehouse_id: stallFilter.selectedWarehouseId,
      },
      stall_options: stallFilter.stallOptions,
      stall_locked: stallFilter.stallLocked,
      summary: {
        transactions: summary.transactions,
        // Nama lama dipertahankan untuk kompatibilitas klien yang sudah ada.
        total_sales: summary.nett,
        total_ark_used: summary.ark_used,
        revenue: summary.revenue,
        discount: summary.discount,
        tax: summary.tax,
        service: summary.service,
        nett: summary.nett,
      },
      per_stall: perStall,
      top_products: topProducts,
      daily,
      rows: revenueRows.map((row) => ({
        id: row.id,
        order_number: row.order_number,
        ordered_at: row.ordered_at,
        status: row.status,
        payment_status: row.payment_status,
        payment_method: row.payment_method,
        payment_method_code: row.payment_method_code,
        payment_method_name: row.payment_method_name,
        subtotal: toNumber(row.subtotal),
        discount_amount: toNumber(row.discount_amount),
        tax_amount: toNumber(row.tax_amount),
        service_charge_amount: toNumber(row.service_charge_amount),
        total_amount: toNumber(row.total_amount),
        ark_coins_used: toNumber(row.ark_coins_used),
        cashier_id: row.cashier_id,
        warehouse_id: row.warehouse_id,
        stall_code: row.stall_code,
        stall_name: row.stall_name,
        checkout_id: row.checkout_id,
        checkout_number: row.checkout_number,
        sold_from: row.sold_from,
        xendit_qr_id: row.xendit_qr_id,
        xendit_external_id: row.xendit_external_id,
        comp_type: row.comp_type ?? null,
        comp_approved_name: row.comp_approved_name ?? null,
      })),
    };

    if (wantsXlsx) {
      return posReportXlsxResponse(
        buildTransactionExportSheets(data),
        transactionExportFileName(data.filters)
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    console.error("Error fetching POS transaction report:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
