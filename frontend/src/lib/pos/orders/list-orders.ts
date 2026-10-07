import { createPgClient } from '@/lib/pg/create-client';
import { parseReportDateRange } from '@/lib/pos/report-stall-filter';

const ORDER_LIST_STATUSES = new Set([
  'pending',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'voided',
  'merged',
]);
const ORDER_LIST_PAYMENT_STATUSES = new Set(['paid', 'unpaid', 'partial', 'refunded']);
const ORDER_LIST_TYPES = new Set(['dine_in', 'takeaway', 'delivery', 'self_order']);
const ORDER_LIST_PAYMENT_METHODS = new Set([
  'cash',
  'qris',
  'credit',
  'credit_card',
  'ark_coin',
  'nfc_tab',
  'gift_card',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CHECKOUT_COLUMNS =
  'id, checkout_number, queue_number, payment_status, payment_method, payment_method_code, payment_method_name, total_amount, created_at';

export function clampOrderListLimit(raw: string | null) {
  // Keputusan owner 2026-08-23: daftar order harus memuat SEMUA baris sesuai
  // filter — 'all' (atau angka besar) diterima. Plafon 10.000 hanya pagar
  // keselamatan browser/respons, bukan pemotong data periode normal.
  if (raw === 'all') return 10_000;
  const parsed = parseInt(raw || '50', 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 10_000);
}

/** Nilai di luar daftar diabaikan; 'credit_card' disimpan sebagai 'credit'. */
export function parsePaymentMethodFilter(raw: string | null) {
  if (!raw || !ORDER_LIST_PAYMENT_METHODS.has(raw)) return null;
  return raw === 'credit_card' ? 'credit' : raw;
}

/** Wildcard ilike/PostgREST dibuang, maks 64 karakter. '' = tanpa filter. */
export function sanitizeOrderSearch(raw: string | null) {
  return (raw?.trim() || '').replace(/[%_*]/g, '').slice(0, 64);
}

function pickAllowed(raw: string | null, allowed: Set<string>) {
  return raw && allowed.has(raw) ? raw : null;
}

export type OrderListFilters = {
  status: string | null;
  customerId: string | null;
  paymentStatus: string | null;
  orderType: string | null;
  paymentMethod: string | null;
  dateRange: ReturnType<typeof parseReportDateRange> | null;
  search: string;
  activeOnly: boolean;
  limit: number;
};

export function parseOrderListFilters(
  params: URLSearchParams
): { ok: true; filters: OrderListFilters } | { ok: false; error: string } {
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');
  let dateRange: OrderListFilters['dateRange'] = null;
  if (dateFrom || dateTo) {
    try {
      dateRange = parseReportDateRange(dateFrom, dateTo);
    } catch (rangeError) {
      return {
        ok: false,
        error: rangeError instanceof Error ? rangeError.message : 'Unknown error',
      };
    }
  }
  return {
    ok: true,
    filters: {
      status: pickAllowed(params.get('status'), ORDER_LIST_STATUSES),
      customerId: params.get('customer_id'),
      paymentStatus: pickAllowed(params.get('payment_status'), ORDER_LIST_PAYMENT_STATUSES),
      orderType: pickAllowed(params.get('order_type'), ORDER_LIST_TYPES),
      paymentMethod: parsePaymentMethodFilter(params.get('payment_method')),
      dateRange,
      search: sanitizeOrderSearch(params.get('q')),
      activeOnly: params.get('active_only') === 'true',
      limit: clampOrderListLimit(params.get('limit')),
    },
  };
}

type PosOrderRow = {
  table_id?: string | null;
  [key: string]: unknown;
};

type CheckoutStamp = {
  id: string;
  checkout_number?: string | null;
  queue_number?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_method_code?: string | null;
  payment_method_name?: string | null;
  total_amount?: number | string | null;
  created_at?: string | null;
};

function uniqueUuids(rows: PosOrderRow[], key: string) {
  return Array.from(
    new Set(
      rows
        .map((row) => row[key])
        .filter((value): value is string => typeof value === 'string' && UUID_RE.test(value))
    )
  );
}

/** Daftar order + nomor checkout, checkout yatim (tanpa order), meja, dan stall. */
export async function listPosOrders(filters: OrderListFilters) {
  const db = createPgClient();
  const { status, customerId, paymentStatus, orderType, paymentMethod, dateRange } = filters;

  let query = db
    .from('pos_orders')
    .select(`
        *,
        customer:pos_customers(name, phone),
        items:pos_order_items(*),
        splits:pos_order_splits(id, split_index, label, total_amount, amount_paid, status)
      `)
    .order('ordered_at', { ascending: false })
    .limit(filters.limit);

  if (status) query = query.eq('status', status);
  if (customerId) query = query.eq('customer_id', customerId);
  if (paymentStatus) query = query.eq('payment_status', paymentStatus);
  if (orderType) query = query.eq('order_type', orderType);
  if (paymentMethod) query = query.eq('payment_method', paymentMethod);
  if (dateRange) {
    query = query.gte('ordered_at', dateRange.startIso).lte('ordered_at', dateRange.endIso);
  }
  if (filters.search) {
    query = query.or(
      `order_number.ilike.%${filters.search}%,queue_number.ilike.%${filters.search}%`
    );
  }
  if (filters.activeOnly) {
    query = query.not('status', 'in', '("completed","cancelled","voided","merged")');
  }

  const { data, error } = await query;
  if (error) throw error;

  const orderRows = (data || []) as PosOrderRow[];
  const checkoutIds = uniqueUuids(orderRows, 'checkout_id');
  let checkoutById = new Map<string, CheckoutStamp>();
  if (checkoutIds.length > 0) {
    const { data: checkouts, error: checkoutError } = await db
      .from('pos_checkouts')
      .select(CHECKOUT_COLUMNS)
      .in('id', checkoutIds);
    if (checkoutError) throw checkoutError;
    checkoutById = new Map(
      ((checkouts || []) as CheckoutStamp[]).map((row) => [String(row.id), row])
    );
  }

  if (dateRange && !filters.activeOnly && !customerId) {
    let orphanQuery = db
      .from('pos_checkouts')
      .select(CHECKOUT_COLUMNS)
      .gte('created_at', dateRange.startIso)
      .lte('created_at', dateRange.endIso)
      .order('created_at', { ascending: false })
      .limit(filters.limit);
    if (paymentStatus) orphanQuery = orphanQuery.eq('payment_status', paymentStatus);
    if (paymentMethod) orphanQuery = orphanQuery.eq('payment_method', paymentMethod);
    const { data: rangeCheckouts, error: orphanError } = await orphanQuery;
    if (orphanError && orphanError.code !== '42P01' && orphanError.code !== 'PGRST205') {
      throw orphanError;
    }
    for (const row of (rangeCheckouts || []) as CheckoutStamp[]) {
      if (checkoutById.has(String(row.id))) continue;
      checkoutById.set(String(row.id), row);
      orderRows.push({
        id: row.id,
        order_number: row.checkout_number,
        queue_number: row.queue_number,
        checkout_id: row.id,
        status: row.payment_status === 'paid' ? 'completed' : 'pending',
        payment_status: row.payment_status,
        payment_method: row.payment_method,
        payment_method_code: row.payment_method_code,
        payment_method_name: row.payment_method_name,
        total_amount: row.total_amount,
        ordered_at: row.created_at,
        sold_from: 'central',
        items: [],
      });
    }
  }

  const tableIds = uniqueUuids(orderRows, 'table_id');
  let tableById = new Map<string, { table_number?: string | null; qr_code?: string | null }>();
  if (tableIds.length > 0) {
    const { data: tables, error: tableError } = await db
      .from('pos_tables')
      .select('id, table_number, qr_code')
      .in('id', tableIds);
    if (tableError) throw tableError;
    tableById = new Map(
      (
        (tables || []) as Array<{ id: string; table_number?: string | null; qr_code?: string | null }>
      ).map((table) => [
        String(table.id),
        { table_number: table.table_number, qr_code: table.qr_code },
      ])
    );
  }

  // EPIC-041 lanjutan (temuan owner: "Stall: —"): nama stall per order —
  // satu query untuk semua warehouse unik, dilekatkan ke tiap baris. Tagihan
  // gabungan multi-stall menampilkan stall lewat order anaknya masing-masing.
  const stallIds = uniqueUuids(orderRows, 'warehouse_id');
  let stallById = new Map<string, { name?: string | null; code?: string | null }>();
  if (stallIds.length > 0) {
    const { data: stalls, error: stallError } = await db
      .from('warehouses')
      .select('id, name, code')
      .in('id', stallIds);
    if (stallError) throw stallError;
    stallById = new Map(
      ((stalls || []) as Array<{ id: string; name?: string | null; code?: string | null }>).map(
        (stall) => [String(stall.id), { name: stall.name, code: stall.code }]
      )
    );
  }

  return orderRows.map((order) => {
    const checkout =
      typeof order.checkout_id === 'string' ? checkoutById.get(order.checkout_id) : null;
    const stall = typeof order.warehouse_id === 'string' ? stallById.get(order.warehouse_id) : null;
    return {
      ...order,
      checkout_number: checkout?.checkout_number || order.checkout_number || null,
      table: order.table_id ? tableById.get(order.table_id) || null : null,
      stall_name: stall?.name ?? null,
      stall_code: stall?.code ?? null,
    };
  });
}
