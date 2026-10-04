import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  enumerateReportPeriods,
  formatPeriodLabel,
  parsePaymentReportGranularity,
  paymentMethodKey,
  periodKeyFromWibDate,
  type PaymentReportGranularity,
} from "@/lib/pos/payment-methods-report";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { formatPaymentMethodLabel } from "@/lib/pos/reports/transaction-labels";

type PaymentLegRow = {
  order_id: string;
  hari_wib: string;
  payment_method: string | null;
  payment_method_code: string | null;
  payment_method_name: string | null;
  amount: number | string;
};

type CatalogRow = {
  code: string;
  name: string;
  sort_order: number | string;
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function emptyPayload(
  range: { dateFrom: string; dateTo: string },
  stallFilter: {
    selectedWarehouseId: string | null;
    stallOptions: unknown;
    stallLocked: boolean;
  },
  granularity: PaymentReportGranularity
) {
  const periods = enumerateReportPeriods(range.dateFrom, range.dateTo, granularity);
  return {
    filters: {
      date_from: range.dateFrom,
      date_to: range.dateTo,
      warehouse_id: stallFilter.selectedWarehouseId,
      granularity,
    },
    stall_options: stallFilter.stallOptions,
    stall_locked: stallFilter.stallLocked,
    summary: {
      total_amount: 0,
      payment_count: 0,
      order_count: 0,
      method_count: 0,
    },
    by_method: [],
    method_columns: [] as Array<{ method_key: string; label: string }>,
    series: periods.map((period) => ({
      period,
      label: formatPeriodLabel(period, granularity),
      total_amount: 0,
      payment_count: 0,
      by_method: [] as Array<{
        method_key: string;
        label: string;
        amount: number;
        payment_count: number;
      }>,
    })),
  };
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
    const granularity = parsePaymentReportGranularity(searchParams.get("granularity"));
    const stallFilter = await resolveReportStallFilter(
      scope,
      searchParams.get("warehouse_id")
    );

    if (stallFilter.warehouseIds && stallFilter.warehouseIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: emptyPayload(range, stallFilter, granularity),
      });
    }

    // Satu baris = satu "leg" pembayaran. Split → pecah dari pos_split_payments;
    // tanpa split → total order ke payment_method order.
    const legs = await query<PaymentLegRow>(
      `WITH filtered_orders AS (
         SELECT
           o.id,
           o.total_amount,
           o.payment_method,
           o.payment_method_code,
           o.payment_method_name,
           (o.ordered_at AT TIME ZONE 'Asia/Jakarta')::date::text AS hari_wib
         FROM pos.pos_orders o
         LEFT JOIN LATERAL (
           SELECT COALESCE(p.warehouse_id, p_sku.warehouse_id) AS warehouse_id
           FROM pos.pos_order_items i
           INNER JOIN pos.pos_products pp ON pp.id = i.product_id
           LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
           LEFT JOIN item.products p_sku
             ON pp.source_product_id IS NULL
            AND pp.sku = ('PUR-' || p_sku.kode)
            AND p_sku.deleted_at IS NULL
            AND p_sku.kode IS NOT NULL
            AND btrim(p_sku.kode) <> ''
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
       ),
       split_legs AS (
         SELECT
           fo.id AS order_id,
           fo.hari_wib,
           sp.payment_method,
           NULL::text AS payment_method_code,
           NULL::text AS payment_method_name,
           sp.amount
         FROM filtered_orders fo
         INNER JOIN pos.pos_split_payments sp ON sp.order_id = fo.id
       ),
       single_legs AS (
         SELECT
           fo.id AS order_id,
           fo.hari_wib,
           fo.payment_method,
           fo.payment_method_code,
           fo.payment_method_name,
           fo.total_amount AS amount
         FROM filtered_orders fo
         WHERE NOT EXISTS (
           SELECT 1 FROM pos.pos_split_payments sp WHERE sp.order_id = fo.id
         )
       )
       SELECT * FROM split_legs
       UNION ALL
       SELECT * FROM single_legs`,
      [range.startIso, range.endIso, stallFilter.warehouseIds]
    );

    let catalog: CatalogRow[] = [];
    try {
      catalog = await query<CatalogRow>(
        `SELECT code, name, sort_order
           FROM pos.payment_methods
          WHERE is_active = true
          ORDER BY sort_order ASC, name ASC`
      );
    } catch {
      catalog = [];
    }

    const catalogByCode = new Map(
      catalog.map((row) => [String(row.code).trim().toLowerCase(), row])
    );

    type Acc = {
      method_key: string;
      payment_method: string | null;
      payment_method_code: string | null;
      payment_method_name: string | null;
      amount: number;
      payment_count: number;
      order_ids: Set<string>;
    };

    const methodTotals = new Map<string, Acc>();
    const periodMethod = new Map<string, Map<string, Acc>>();
    const allOrderIds = new Set<string>();

    for (const leg of legs) {
      const key = paymentMethodKey(leg);
      const amount = toNumber(leg.amount);
      const period = periodKeyFromWibDate(leg.hari_wib, granularity);
      allOrderIds.add(leg.order_id);

      const bump = (map: Map<string, Acc>) => {
        const cur = map.get(key) ?? {
          method_key: key,
          payment_method: leg.payment_method,
          payment_method_code: leg.payment_method_code,
          payment_method_name: leg.payment_method_name,
          amount: 0,
          payment_count: 0,
          order_ids: new Set<string>(),
        };
        if (!cur.payment_method_code && leg.payment_method_code) {
          cur.payment_method_code = leg.payment_method_code;
        }
        if (!cur.payment_method_name && leg.payment_method_name) {
          cur.payment_method_name = leg.payment_method_name;
        }
        if (!cur.payment_method && leg.payment_method) {
          cur.payment_method = leg.payment_method;
        }
        cur.amount += amount;
        cur.payment_count += 1;
        cur.order_ids.add(leg.order_id);
        map.set(key, cur);
      };

      bump(methodTotals);
      if (!periodMethod.has(period)) periodMethod.set(period, new Map());
      bump(periodMethod.get(period)!);
    }

    const resolveLabel = (acc: {
      method_key: string;
      payment_method: string | null;
      payment_method_code: string | null;
      payment_method_name: string | null;
    }) => {
      const fromCatalog = catalogByCode.get(acc.method_key);
      return formatPaymentMethodLabel(acc.payment_method || acc.method_key, {
        code: acc.payment_method_code || fromCatalog?.code || acc.method_key,
        name: acc.payment_method_name || fromCatalog?.name || null,
      });
    };

    const totalAmount = Array.from(methodTotals.values()).reduce(
      (sum, row) => sum + row.amount,
      0
    );

    const byMethod = Array.from(methodTotals.values())
      .map((row) => {
        const amount = roundMoney(row.amount);
        return {
          method_key: row.method_key,
          payment_method: row.payment_method,
          payment_method_code: row.payment_method_code,
          payment_method_name: row.payment_method_name,
          label: resolveLabel(row),
          amount,
          payment_count: row.payment_count,
          order_count: row.order_ids.size,
          pct: totalAmount > 0 ? Math.round((amount / totalAmount) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

    // Kolom detail: metode yang muncul di periode + katalog aktif (isi 0).
    const methodColumns = new Map<
      string,
      { method_key: string; label: string; sort: number }
    >();
    for (const row of byMethod) {
      const cat = catalogByCode.get(row.method_key);
      methodColumns.set(row.method_key, {
        method_key: row.method_key,
        label: row.label,
        sort: cat ? toNumber(cat.sort_order) : 10_000,
      });
    }
    for (const cat of catalog) {
      const key = String(cat.code).trim().toLowerCase();
      if (methodColumns.has(key)) continue;
      methodColumns.set(key, {
        method_key: key,
        label: formatPaymentMethodLabel(key, { code: cat.code, name: cat.name }),
        sort: toNumber(cat.sort_order),
      });
    }
    const columns = Array.from(methodColumns.values()).sort(
      (a, b) => a.sort - b.sort || a.label.localeCompare(b.label)
    );

    const periods = enumerateReportPeriods(range.dateFrom, range.dateTo, granularity);
    const series = periods.map((period) => {
      const bucket = periodMethod.get(period) ?? new Map<string, Acc>();
      const by_method = columns.map((col) => {
        const hit = bucket.get(col.method_key);
        return {
          method_key: col.method_key,
          label: col.label,
          amount: roundMoney(hit?.amount ?? 0),
          payment_count: hit?.payment_count ?? 0,
        };
      });
      return {
        period,
        label: formatPeriodLabel(period, granularity),
        total_amount: roundMoney(by_method.reduce((sum, row) => sum + row.amount, 0)),
        payment_count: by_method.reduce((sum, row) => sum + row.payment_count, 0),
        by_method,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        filters: {
          date_from: range.dateFrom,
          date_to: range.dateTo,
          warehouse_id: stallFilter.selectedWarehouseId,
          granularity,
        },
        stall_options: stallFilter.stallOptions,
        stall_locked: stallFilter.stallLocked,
        summary: {
          total_amount: roundMoney(totalAmount),
          payment_count: legs.length,
          order_count: allOrderIds.size,
          method_count: byMethod.length,
        },
        by_method: byMethod,
        method_columns: columns.map(({ method_key, label }) => ({ method_key, label })),
        series,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching POS payment methods report:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
