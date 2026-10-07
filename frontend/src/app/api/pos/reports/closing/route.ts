import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getApiUser, getPosSession } from "@/lib/api/auth";
import {
  formatReportDate,
  formatReportTime,
  percentage,
  resolveSegment,
  roundCurrency,
  SEGMENT_LABELS,
  summarizeClosingTransactions,
  targetBlock,
  toNumber,
  type SalesSegmentCode,
} from "@/lib/pos/closing-report-helpers";
import { todayWib } from "@/lib/pos/report-dates";

type PosOrderRow = {
  id: string;
  shift_id?: string | null;
  order_type?: string | null;
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  tax_amount?: number | string | null;
  service_charge_amount?: number | string | null;
  total_amount?: number | string | null;
  ordered_at?: string | null;
  completed_at?: string | null;
  discount_reason?: string | null;
};

type PosOrderItemRow = {
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  total_amount?: number | string | null;
  discount_amount?: number | string | null;
  station?: string | null;
};

type PosShiftRow = {
  id: string;
  shift_number?: string | null;
  branch_id?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  status?: string | null;
};

type PosProductRow = {
  id: string;
  category_id?: string | null;
};

type PosCategoryRow = {
  id: string;
  name?: string | null;
};

type BranchRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

function paidOrdersQuery(db: ReturnType<typeof createPgClient>, startIso: string, endIso: string) {
  // Alur POS live menyisakan order LUNAS berstatus 'pending' — status
  // fulfilment tidak pernah maju ke 'completed', sehingga filter lama membuat
  // laporan ini SELALU nol. Pendapatan = dibayar dan tidak batal, definisi
  // yang sama dengan laporan transaksi.
  return db
    .from("pos_orders")
    .select(
      "id, shift_id, order_type, subtotal, discount_amount, tax_amount, service_charge_amount, total_amount, ordered_at, completed_at, discount_reason"
    )
    .not("status", "in", '("cancelled","voided","merged")')
    .eq("payment_status", "paid")
    .is("voided_at", null)
    .gte("ordered_at", startIso)
    .lte("ordered_at", endIso);
}

async function loadSettings() {
  // Sebelumnya membaca tabel bare "settings" yang tidak ada — error-nya
  // tertelan destructuring dan target selalu nol. Sumber yang benar:
  // configuration.app_settings (pola DeepSeek/Google BP/WA gateway).
  const { getSettings } = await import("@/lib/settings/app-settings");
  const stored = await getSettings([
    "pos_monthly_sales_target",
    "pos_daily_sales_target",
    "pos_outlet_name",
  ]).catch(() => ({}) as Record<string, string | null>);
  return {
    monthlyTarget: toNumber(stored["pos_monthly_sales_target"]),
    dailyTarget: toNumber(stored["pos_daily_sales_target"]),
    outletName: stored["pos_outlet_name"] || null,
  };
}

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get("date") || todayWib();
    const shiftId = searchParams.get("shift_id");
    // Hari operasional WIB — jendela UTC membuat order malam pindah tanggal.
    const startIso = `${date}T00:00:00.000+07:00`;
    const endIso = `${date}T23:59:59.999+07:00`;

    let ordersQuery = paidOrdersQuery(db, startIso, endIso);
    if (shiftId) ordersQuery = ordersQuery.eq("shift_id", shiftId);

    const [{ data: orders, error: orderError }, { data: shifts, error: shiftError }, settings, apiUser] =
      await Promise.all([
        ordersQuery,
        db
          .from("pos_shifts")
          .select("id, shift_number, branch_id, opened_at, closed_at, status")
          .gte("opened_at", startIso)
          .lte("opened_at", endIso)
          .order("opened_at", { ascending: true }),
        loadSettings(),
        getApiUser(),
      ]);

    if (orderError) throw orderError;
    if (shiftError) throw shiftError;

    const orderRows = (orders || []) as PosOrderRow[];
    const shiftRows = (shifts || []) as PosShiftRow[];
    const orderIds = orderRows.map((order) => order.id);

    const branchIds = Array.from(
      new Set(shiftRows.map((shift) => shift.branch_id).filter((id): id is string => Boolean(id)))
    );

    const { data: branches } = branchIds.length
      ? await db.from("branches").select("id, name, code").in("id", branchIds)
      : { data: [] };

    const branchById = new Map(((branches || []) as BranchRow[]).map((branch) => [branch.id, branch]));

    let itemRows: PosOrderItemRow[] = [];
    if (orderIds.length > 0) {
      const { data: items, error: itemError } = await db
        .from("pos_order_items")
        .select("order_id, product_id, product_name, quantity, total_amount, discount_amount, station")
        .in("order_id", orderIds);
      if (itemError) throw itemError;
      itemRows = (items || []) as PosOrderItemRow[];
    }

    const productIds = Array.from(
      new Set(itemRows.map((item) => item.product_id).filter((id): id is string => Boolean(id)))
    );

    const { data: products } = productIds.length
      ? await db.from("pos_products").select("id, category_id").in("id", productIds)
      : { data: [] };

    const productById = new Map(((products || []) as PosProductRow[]).map((product) => [product.id, product]));

    const categoryIds = Array.from(
      new Set(
        ((products || []) as PosProductRow[])
          .map((product) => product.category_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const { data: categories } = categoryIds.length
      ? await db.from("pos_categories").select("id, name").in("id", categoryIds)
      : { data: [] };

    const categoryById = new Map(
      ((categories || []) as PosCategoryRow[]).map((category) => [category.id, category.name || "Others"])
    );

    let netSales = 0;
    let service = 0;
    let tax = 0;
    let discount = 0;

    for (const order of orderRows) {
      const orderSubtotal = toNumber(order.subtotal);
      const orderDiscount = toNumber(order.discount_amount);
      const orderTax = toNumber(order.tax_amount);
      const orderService = toNumber(order.service_charge_amount);

      netSales += orderSubtotal - orderDiscount;
      service += orderService;
      tax += orderTax;
      discount += orderDiscount;
    }

    netSales = roundCurrency(netSales);
    service = roundCurrency(service);
    tax = roundCurrency(tax);
    discount = roundCurrency(discount);
    const gross = roundCurrency(netSales + service + tax);
    const transactionTotals = summarizeClosingTransactions(orderRows);

    const guestCount = orderRows.filter((order) => order.order_type === "dine_in").length || orderRows.length;
    const averagePerPax = guestCount > 0 ? roundCurrency(netSales / guestCount) : 0;

    const categoryTotals = new Map<string, { segment: SalesSegmentCode; name: string; amount: number }>();

    for (const item of itemRows) {
      const product = item.product_id ? productById.get(item.product_id) : null;
      const categoryName = product?.category_id
        ? categoryById.get(product.category_id) || "Others"
        : "Others";
      const segment = resolveSegment(item.station);
      const key = `${segment}:${categoryName}`;
      const amount = toNumber(item.total_amount);
      const existing = categoryTotals.get(key) || { segment, name: categoryName, amount: 0 };
      existing.amount += amount;
      categoryTotals.set(key, existing);
    }

    const categoriesBySegment: Array<{
      segment: SalesSegmentCode;
      title: string;
      rows: Array<{ name: string; amount: number; percentage: number }>;
    }> = [];

    for (const segment of ["FNB", "BEV", "OTHER"] as SalesSegmentCode[]) {
      const rows = Array.from(categoryTotals.values())
        .filter((row) => row.segment === segment)
        .map((row) => ({
          name: row.name,
          amount: roundCurrency(row.amount),
          percentage: percentage(row.amount, netSales),
        }))
        .sort((a, b) => b.amount - a.amount);

      if (rows.length === 0) {
        rows.push({ name: "Others", amount: 0, percentage: 0 });
      }

      categoriesBySegment.push({
        segment,
        title: `SALES BY CATEGORY ${SEGMENT_LABELS[segment].toUpperCase()}`,
        rows,
      });
    }

    const promoMap = new Map<string, { segment: SalesSegmentCode; name: string; qty: number }>();
    for (const item of itemRows) {
      const itemDiscount = toNumber(item.discount_amount);
      if (itemDiscount <= 0) continue;
      const segment = resolveSegment(item.station);
      const name = item.product_name || "Promo Item";
      const key = `${segment}:${name}`;
      const existing = promoMap.get(key) || { segment, name, qty: 0 };
      existing.qty += toNumber(item.quantity);
      promoMap.set(key, existing);
    }

    for (const order of orderRows) {
      if (!order.discount_reason) continue;
      const segment: SalesSegmentCode = "FNB";
      const key = `${segment}:${order.discount_reason}`;
      const existing = promoMap.get(key) || { segment, name: order.discount_reason, qty: 0 };
      existing.qty += 1;
      promoMap.set(key, existing);
    }

    const promosBySegment = (["FNB", "BEV"] as SalesSegmentCode[]).map((segment) => ({
      segment,
      title: `PROMO ${SEGMENT_LABELS[segment].toUpperCase()}`,
      rows: Array.from(promoMap.values())
        .filter((row) => row.segment === segment)
        .map((row) => ({ name: row.name, qty: Math.round(row.qty) }))
        .sort((a, b) => b.qty - a.qty),
    }));

    const ordersByShift = new Map<string, PosOrderRow[]>();
    for (const order of orderRows) {
      const key = order.shift_id || "unassigned";
      const bucket = ordersByShift.get(key) || [];
      bucket.push(order);
      ordersByShift.set(key, bucket);
    }

    const shiftSessions = shiftRows.length
      ? shiftRows.map((shift) => {
          const shiftOrders = ordersByShift.get(shift.id) || [];
          const lastOrderAt = shiftOrders.reduce<string | null>((latest, order) => {
            const stamp = order.completed_at || order.ordered_at;
            if (!stamp) return latest;
            if (!latest || new Date(stamp) > new Date(latest)) return stamp;
            return latest;
          }, null);
          const branch = shift.branch_id ? branchById.get(shift.branch_id) : null;
          const label = branch?.code || branch?.name || shift.shift_number || "Shift";

          return {
            label,
            last_order: formatReportTime(lastOrderAt),
            closed_at: formatReportTime(shift.closed_at),
          };
        })
      : [
          {
            label: "All",
            last_order: formatReportTime(
              orderRows.reduce<string | null>((latest, order) => {
                const stamp = order.completed_at || order.ordered_at;
                if (!stamp) return latest;
                if (!latest || new Date(stamp) > new Date(latest)) return stamp;
                return latest;
              }, null)
            ),
            closed_at: formatReportTime(orderRows.length ? endIso : null),
          },
        ];

    const reportDate = new Date(`${date}T12:00:00`);
    const daysInMonth = new Date(reportDate.getFullYear(), reportDate.getMonth() + 1, 0).getDate();
    const dayOfMonth = reportDate.getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = reportDate.getFullYear();
    const m = reportDate.getMonth() + 1;
    const monthStartIso = `${y}-${pad(m)}-01T00:00:00.000+07:00`;
    const monthEndIso = `${y}-${pad(m)}-${pad(daysInMonth)}T23:59:59.999+07:00`;

    const { data: monthOrders } = await paidOrdersQuery(db, monthStartIso, monthEndIso);

    const monthlyActual = roundCurrency(
      ((monthOrders || []) as PosOrderRow[]).reduce((sum, order) => {
        return sum + toNumber(order.subtotal) - toNumber(order.discount_amount);
      }, 0)
    );

    const { data: mtdOrders } = await paidOrdersQuery(db, monthStartIso, endIso);

    const monthToDateActual = roundCurrency(
      ((mtdOrders || []) as PosOrderRow[]).reduce((sum, order) => {
        return sum + toNumber(order.subtotal) - toNumber(order.discount_amount);
      }, 0)
    );

    const monthlyTarget = settings.monthlyTarget;
    const computedDailyTarget =
      settings.dailyTarget > 0 ? settings.dailyTarget : monthlyTarget > 0 ? monthlyTarget / daysInMonth : 0;
    const monthToDateTarget =
      monthlyTarget > 0 ? (monthlyTarget / daysInMonth) * dayOfMonth : computedDailyTarget * dayOfMonth;

    const outletNames = Array.from(
      new Set(
        shiftRows
          .map((shift) => {
            const branch = shift.branch_id ? branchById.get(shift.branch_id) : null;
            return branch?.name || branch?.code;
          })
          .filter(Boolean)
      )
    );

    const outletLine =
      outletNames.length > 0
        ? outletNames.join(" & ")
        : settings.outletName || "Outlet";

    return NextResponse.json({
      success: true,
      data: {
        filters: { date, shift_id: shiftId },
        header: {
          title: `Daily Report Sales ${outletLine}`,
          outlet_line: outletLine,
          report_date: formatReportDate(date),
        },
        shift_sessions: shiftSessions,
        sales_summary: {
          net_sales: netSales,
          service,
          tax,
          discount,
          gross,
        },
        transaction_totals: transactionTotals,
        guests: {
          count: guestCount,
          average_per_pax: averagePerPax,
        },
        categories_by_segment: categoriesBySegment,
        targets: {
          daily: targetBlock(netSales, computedDailyTarget),
          monthly: targetBlock(monthlyActual, monthlyTarget),
          month_to_date: targetBlock(monthToDateActual, monthToDateTarget),
        },
        promos_by_segment: promosBySegment,
        footer: {
          printed_by: apiUser?.full_name || sessionUserId,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cashier closing report";
    console.error("Error fetching POS closing report:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
