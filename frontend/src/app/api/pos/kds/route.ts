import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { requirePosMenu } from '@/lib/api/auth';
import { IAM } from '@/lib/iam/prefixes';
import { normalizeStation } from '@/lib/pos/kitchen-station';
import {
  deriveStationStatus,
  isFnbStation,
  isTerminalKitchenStatus,
  mapOrderStatusToKitchenStatus,
} from '@/lib/pos/kds-status';

type KDSOrderItemRow = {
  id: string;
  product_id?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  variants?: unknown;
  modifiers?: unknown;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  kitchen_notes?: string | null;
  station?: string | null;
  kitchen_status?: string | null;
  kitchen_started_at?: string | null;
  kitchen_ready_at?: string | null;
  served_at?: string | null;
};

type KDSOrderRow = {
  id: string;
  order_number: string;
  queue_number?: string | null;
  checkout_id?: string | null;
  warehouse_id?: string | null;
  status: string;
  payment_status?: string | null;
  order_type?: string | null;
  table_id?: string | null;
  notes?: string | null;
  special_requests?: string | null;
  ordered_at?: string | null;
  confirmed_at?: string | null;
  pos_order_items?: KDSOrderItemRow[] | null;
};

type PosTableRow = {
  id: string;
  table_number?: string | null;
  qr_code?: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatVariantInfo(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === 'object' && item ? (item as { name?: string }).name : '')).filter(Boolean).join(', ')
    : '';
}

/** GET /api/pos/kds
 *  Tickets are pos_orders only (child / stall) — never pos_checkouts rows.
 *  Query params:
 *    - status: pending,confirmed,preparing,ready (default multi)
 *    - station: kitchen, bar, bakery, dessert, merchandise, photobooth
 *    - warehouse_id: optional stall filter
 *    - limit: default 50
 *    - branch_id: optional
 */
export async function GET(request: NextRequest) {
  const pos = await requirePosMenu(IAM.posKitchen);
  if (pos.error) return pos.error;

  const { searchParams } = new URL(request.url);
  const station = searchParams.get('station');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const branchId = searchParams.get('branch_id');
  const warehouseId = searchParams.get('warehouse_id');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');

  const db = createPgClient();

  const excludedStatuses = ['voided', 'cancelled', 'merged', 'completed'];

  const baseSelect = `
      id,
      order_number,
      queue_number,
      checkout_id,
      warehouse_id,
      status,
      payment_status,
      order_type,
      table_id,
      notes,
      special_requests,
      ordered_at,
      confirmed_at,
      pos_order_items (
        id,
        product_id,
        product_name,
        product_sku,
        variants,
        modifiers,
        quantity,
        unit_price,
        kitchen_notes
      )
    `;

  const stationSelect = `
      id,
      order_number,
      queue_number,
      checkout_id,
      warehouse_id,
      status,
      payment_status,
      order_type,
      table_id,
      notes,
      special_requests,
      ordered_at,
      confirmed_at,
      pos_order_items (
        id,
        product_id,
        product_name,
        product_sku,
        variants,
        modifiers,
        quantity,
        unit_price,
        kitchen_notes,
        station,
        kitchen_status,
        kitchen_started_at,
        kitchen_ready_at,
        served_at
      )
    `;

  let query = db
    .from('pos_orders')
    .select(stationSelect)
    .not('status', 'in', excludedStatuses)
    .order('ordered_at', { ascending: false })
    .limit(Math.max(limit, 80));

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }
  if (warehouseId && isUuid(warehouseId)) {
    query = query.eq('warehouse_id', warehouseId);
  }
  if (dateFrom) {
    query = query.gte('ordered_at', dateFrom);
  }
  if (dateTo) {
    query = query.lt('ordered_at', dateTo);
  }

  const stationResult = await query;
  let data = stationResult.data as unknown as KDSOrderRow[] | null;
  let error = stationResult.error;

  if (error?.code === '42703' || error?.code === 'PGRST200') {
    let legacyQuery = db
      .from('pos_orders')
      .select(baseSelect)
      .not('status', 'in', excludedStatuses)
      .order('ordered_at', { ascending: false })
      .limit(Math.max(limit, 80));

    if (branchId) {
      legacyQuery = legacyQuery.eq('branch_id', branchId);
    }
    if (warehouseId && isUuid(warehouseId)) {
      legacyQuery = legacyQuery.eq('warehouse_id', warehouseId);
    }
    if (dateFrom) {
      legacyQuery = legacyQuery.gte('ordered_at', dateFrom);
    }
    if (dateTo) {
      legacyQuery = legacyQuery.lt('ordered_at', dateTo);
    }

    const legacyResult = await legacyQuery;
    data = legacyResult.data as unknown as KDSOrderRow[] | null;
    error = legacyResult.error;
  }

  if (error) {
    console.error('KDS query error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const orderRows = (data || []) as KDSOrderRow[];
  const tableIds = Array.from(
    new Set(
      orderRows
        .map((order) => order.table_id)
        .filter((value): value is string => typeof value === 'string' && isUuid(value))
    )
  );
  let tableById = new Map<string, PosTableRow>();

  if (tableIds.length > 0) {
    const { data: tables, error: tableError } = await db
      .from('pos_tables')
      .select('id, table_number, qr_code')
      .in('id', tableIds);

    if (!tableError) {
      tableById = new Map(((tables || []) as PosTableRow[]).map((table) => [table.id, table]));
    }
  }

  const wantedStation = station ? station.toLowerCase() : null;
  const orders = orderRows
    .map((order) => {
      const items = (order.pos_order_items || [])
        .map((item) => {
          const itemStation = normalizeStation(item.station, item.product_name || '', item.kitchen_notes || '');
          return {
            ...item,
            station: itemStation,
            kitchen_status: item.kitchen_status || mapOrderStatusToKitchenStatus(order.status),
            variant_info: formatVariantInfo(item.variants),
            modifier_info: formatVariantInfo(item.modifiers),
            notes: item.kitchen_notes || '',
          };
        })
        .filter((item) => {
          if (!isFnbStation(item.station)) return false;
          if (isTerminalKitchenStatus(item.kitchen_status)) return false;
          if (wantedStation && item.station !== wantedStation) return false;
          return true;
        });
      const stationStatus = deriveStationStatus(items, wantedStation);
      return {
        ...order,
        station_status: stationStatus,
        status: wantedStation ? stationStatus : order.status,
        table_label: order.table_id
          ? tableById.get(order.table_id)?.table_number || tableById.get(order.table_id)?.qr_code || null
          : null,
        pos_order_items: items,
      };
    })
    .filter((order) => order.pos_order_items.length > 0);

  const now = Date.now();
  const ordersWithWait = orders.map((order) => {
    const orderedAt = order.ordered_at ? new Date(order.ordered_at).getTime() : now;
    const waitSeconds = Math.floor((now - orderedAt) / 1000);
    const waitMinutes = Math.floor(waitSeconds / 60);
    return {
      ...order,
      wait_seconds: waitSeconds,
      wait_minutes: waitMinutes,
      is_overdue: waitMinutes > 15,
      is_urgent: waitMinutes > 10,
    };
  });

  return NextResponse.json({
    success: true,
    data: ordersWithWait,
    count: ordersWithWait.length,
  });
}
