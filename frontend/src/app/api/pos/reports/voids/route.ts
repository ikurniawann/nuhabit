import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { displayActorName, summarizeVoidRows } from "@/lib/pos/void-report";

type VoidOrderRow = {
  id: string;
  order_number: string | null;
  checkout_number: string | null;
  checkout_id: string | null;
  ordered_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_name: string | null;
  voided_by_name: string | null;
  stall_name: string | null;
  stall_code: string | null;
  total_amount: number | string | null;
  payment_method: string | null;
  payment_method_code: string | null;
  payment_method_name: string | null;
  sold_from: string | null;
};

type VoidItemRow = {
  id: string;
  order_id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  total_amount: number | string | null;
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
    const range = parseReportDateRange(
      searchParams.get("date_from"),
      searchParams.get("date_to")
    );
    const stallFilter = await resolveReportStallFilter(
      scope,
      searchParams.get("warehouse_id")
    );

    if (stallFilter.warehouseIds && stallFilter.warehouseIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          filters: {
            date_from: range.dateFrom,
            date_to: range.dateTo,
            warehouse_id: stallFilter.selectedWarehouseId,
          },
          stall_options: stallFilter.stallOptions,
          stall_locked: stallFilter.stallLocked,
          summary: { voids: 0, amount: 0 },
          rows: [],
        },
      });
    }

    const orders = await query<VoidOrderRow>(
      `SELECT
         o.id,
         o.order_number,
         o.checkout_id,
         o.sold_from,
         o.ordered_at,
         o.voided_at,
         o.void_reason,
         o.total_amount,
         o.payment_method,
         o.payment_method_code,
         o.payment_method_name,
         chk.checkout_number,
         cashier.full_name AS created_by_name,
         voider.full_name AS voided_by_name,
         COALESCE(w_order.name, stall_from_item.stall_name) AS stall_name,
         COALESCE(w_order.code, stall_from_item.stall_code) AS stall_code
       FROM pos.pos_orders o
       LEFT JOIN pos.pos_checkouts chk ON chk.id = o.checkout_id
       LEFT JOIN configuration.users cashier ON cashier.id = o.cashier_id
       LEFT JOIN configuration.users voider ON voider.id = o.voided_by
       LEFT JOIN configuration.warehouses w_order ON w_order.id = o.warehouse_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(w.code, w_sku.code) AS stall_code,
           COALESCE(w.name, w_sku.name) AS stall_name,
           COALESCE(p.warehouse_id, p_sku.warehouse_id) AS warehouse_id
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
       WHERE o.status = 'voided'
         AND COALESCE(o.voided_at, o.ordered_at) >= $1::timestamptz
         AND COALESCE(o.voided_at, o.ordered_at) <= $2::timestamptz
         AND (
           $3::uuid[] IS NULL
           OR o.warehouse_id = ANY($3::uuid[])
           OR (
             o.warehouse_id IS NULL
             AND stall_from_item.warehouse_id = ANY($3::uuid[])
           )
         )
       ORDER BY COALESCE(o.voided_at, o.ordered_at) DESC NULLS LAST`,
      [range.startIso, range.endIso, stallFilter.warehouseIds]
    );

    const orderIds = orders.map((row) => row.id);
    const itemRows =
      orderIds.length > 0
        ? await query<VoidItemRow>(
            `SELECT id, order_id, product_name, product_sku, quantity, unit_price, total_amount
               FROM pos.pos_order_items
              WHERE order_id = ANY($1::uuid[])
              ORDER BY created_at, id`,
            [orderIds]
          )
        : [];

    const itemsByOrder = new Map<string, VoidItemRow[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }

    const rows = orders.map((row) => ({
      id: row.id,
      order_number: row.order_number,
      checkout_number: row.checkout_number,
      checkout_id: row.checkout_id,
      ordered_at: row.ordered_at,
      voided_at: row.voided_at,
      void_reason: row.void_reason,
      created_by_name: displayActorName(row.created_by_name, "Kasir"),
      voided_by_name: displayActorName(row.voided_by_name, "Supervisor"),
      stall_name: row.stall_name,
      stall_code: row.stall_code,
      total_amount: toNumber(row.total_amount),
      payment_method: row.payment_method,
      payment_method_code: row.payment_method_code,
      payment_method_name: row.payment_method_name,
      sold_from: row.sold_from,
      items: (itemsByOrder.get(row.id) ?? []).map((item) => ({
        id: item.id,
        product_name: item.product_name || "—",
        product_sku: item.product_sku,
        quantity: toNumber(item.quantity),
        unit_price: toNumber(item.unit_price),
        total_amount: toNumber(item.total_amount),
      })),
    }));

    const summary = summarizeVoidRows(rows);

    return NextResponse.json({
      success: true,
      data: {
        filters: {
          date_from: range.dateFrom,
          date_to: range.dateTo,
          warehouse_id: stallFilter.selectedWarehouseId,
        },
        stall_options: stallFilter.stallOptions,
        stall_locked: stallFilter.stallLocked,
        summary,
        rows,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching POS void report:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
