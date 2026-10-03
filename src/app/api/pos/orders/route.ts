import { randomUUID } from 'crypto';
import { resolveOrderItemSkus } from '@/lib/pos/order-item-sku';
import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from '@/lib/crm/loyalty-engine';
import { getCrmDefaultVenue } from '@/lib/crm/server';
import { checkProductPrivileges } from '@/lib/crm/product-privilege';
import { buildCostSnapshot, loadPosProductCostMap } from '@/lib/pos/purchasing-sync';
import {
  claimMerchandiseStock,
  hasTrackedMerchandise,
  restoreMerchandiseStock,
  type MerchStockClaim,
} from '@/lib/pos/merchandise-stock';
import { normalizeGuestCount } from '@/lib/pos/guest-count';
import { getApiUserScope } from '@/lib/api/scope';
import { getStallAccess } from '@/lib/auth/stall-access';
import {
  assertAllModeSellStallAssigned,
  canSellMixedStall,
  resolveSingleStallSellFromAllMode,
} from '@/lib/pos/central-cashier';
import {
  MixedCheckoutError,
  createMixedCheckout,
  guardMixedCheckoutCart,
  resolveOrderSoldFrom,
} from '@/lib/pos/create-mixed-checkout';
import {
  assertOrderItemsMatchSellStall,
  loadCentralCashierGate,
  loadPosProductWarehouseIds,
  resolvePosSellStallForUser,
} from '@/lib/pos/pos-sell-stall-server';
import { queryOne, withTransaction } from '@/lib/db';
import {
  PromoRejectedError,
  capturePromoRedemption,
  holdPromoRedemption,
  releasePromoRedemption,
  type PromoHold,
} from '@/lib/promo/promo-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidNfcUid, normalizeNfcUid } from '@/lib/ticketing/server';
import { chargeFnbOrderToTab } from '@/lib/ticketing/tab-server';
import {
  issueGiftCardsForPosOrder,
  prepareGiftCardSale,
  redeemGiftCardForPosOrder,
  refundGiftCardForPosOrder,
  type IssuedGiftCard,
} from '@/lib/giftcard/giftcard-server';
import { sendGiftCardSoldWa } from '@/lib/giftcard/gift-card-wa';
import { allocateQueueNumber, ensureQueueNumber } from '@/lib/pos/queue-number';
import {
  backfillMissingItemStations,
  buildKitchenPrintJobs,
  normalizeStation,
} from '@/lib/pos/kitchen-station';
import { AccountingPostError } from '@/lib/pos/accounting-posting';
import { isFocPaymentMethod, resolvePaymentCatalogStamp } from '@/lib/pos/payment-methods';
import { verifySupervisorPinServer } from '@/lib/pos/supervisor-pin-server';
import { notifyCompTransaction } from '@/lib/wa/comp-notification';
import { sanitizeXenditRef } from '@/lib/pos/xendit-ids';
import { assertQrisSaleMaySettle } from '@/lib/pos/qris-settle-guard';
import {
  buildDiscountReason,
  computeOrderDiscountStack,
  type DiscountType,
} from '@/lib/pos/manual-discount';
import { evaluateActiveOffersForPosCart } from '@/lib/promo/offer-pos';
import {
  OfferCapReachedError,
  captureOfferUsage,
  recordOfferUsage,
} from '@/lib/promo/offer-rules-server';
import { parseReportDateRange } from '@/lib/pos/report-stall-filter';
import { validateKolComp } from '@/lib/pos/comp-orders-server';
import { rejectIfArkCoinDisabled } from '@/lib/crm/loyalty-features-server';

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

function clampOrderListLimit(raw: string | null) {
  // Keputusan owner 2026-08-23: daftar order harus memuat SEMUA baris sesuai
  // filter — 'all' (atau angka besar) diterima. Plafon 10.000 hanya pagar
  // keselamatan browser/respons, bukan pemotong data periode normal.
  if (raw === 'all') return 10_000;
  const parsed = parseInt(raw || '50', 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 10_000);
}

type PosOrderItemRequest = {
  product_id?: string;
  /** EPIC-039 Fase B — varian merchandise ber-stok; wajib utk produk ber-SKU */
  sku_id?: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number | string;
  unit_price?: number | string;
  variant_price_adjustment?: number | string;
  modifier_price_adjustment?: number | string;
  variants?: unknown[];
  modifiers?: unknown[];
  station?: string;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_amount?: number | string;
};

type PosOrderBody = {
  order_type?: string;
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong/aneh → 1 orang. */
  guest_count?: number | string;
  items?: PosOrderItemRequest[];
  subtotal?: number | string;
  discount_amount?: number | string;
  discount_reason?: string;
  manual_discount_type?: string | null;
  manual_discount_value?: number | string | null;
  /** EPIC-032 C1 — kode promo (server evaluasi & override diskon). */
  promo_code?: string;
  membership_discount_pct?: number | string;
  tax_amount?: number | string;
  service_charge_amount?: number | string;
  other_charges_amount?: number | string;
  charges_breakdown?: unknown;
  total_amount?: number | string;
  payment_method?: string;
  amount_paid?: number | string;
  notes?: string;
  special_requests?: string;
  ark_coins_used?: number | string;
  include_tax?: boolean;
  splits?: unknown[];
  branch_id?: string;
  shift_id?: string;
  /** UID gelang ticketing — wajib saat payment_method 'nfc_tab' (EPIC-023 Fase C) */
  nfc_tab_uid?: string;
  /** Kode gift card — wajib saat payment_method 'gift_card' (EPIC-034 Fase C) */
  gift_card_code?: string;
  /** Data pembeli saat MENJUAL gift card — nomor dipakai kirim kode via WA (Fase B) */
  gift_card_buyer_name?: string;
  gift_card_buyer_phone?: string;
  xendit_qr_id?: string;
  xendit_external_id?: string;
  payment_method_code?: string;
  payment_method_name?: string;
  /** EPIC-043: 'kol_comp' = komplimen KOL (divalidasi server, gratis penuh). */
  comp_type?: string;
  /** PIN supervisor — wajib saat metode bayar FOC (Free of Charge). */
  supervisor_pin?: string;
};

type PosOrderRow = {
  table_id?: string | null;
  [key: string]: unknown;
};

type PosTableRow = {
  id: string;
  table_number?: string | null;
  qr_code?: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}


// GET /api/pos/orders — list orders with filters
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const customerId = searchParams.get('customer_id');
    const paymentStatus = searchParams.get('payment_status');
    const orderType = searchParams.get('order_type');
    const paymentMethod = searchParams.get('payment_method');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const search = searchParams.get('q')?.trim() || '';
    const activeOnly = searchParams.get('active_only') === 'true';
    const limit = clampOrderListLimit(searchParams.get('limit'));
    let dateRange: ReturnType<typeof parseReportDateRange> | null = null;
    if (dateFrom || dateTo) {
      try {
        dateRange = parseReportDateRange(dateFrom, dateTo);
      } catch (rangeError) {
        return NextResponse.json(
          { success: false, error: getErrorMessage(rangeError) },
          { status: 400 }
        );
      }
    }

    let query = db
      .from('pos_orders')
      .select(`
        *,
        customer:pos_customers(name, phone),
        items:pos_order_items(*),
        splits:pos_order_splits(id, split_index, label, total_amount, amount_paid, status)
      `)
      .order('ordered_at', { ascending: false })
      .limit(limit);

    if (status && ORDER_LIST_STATUSES.has(status)) query = query.eq('status', status);
    if (customerId) query = query.eq('customer_id', customerId);
    if (paymentStatus && ORDER_LIST_PAYMENT_STATUSES.has(paymentStatus)) {
      query = query.eq('payment_status', paymentStatus);
    }
    if (orderType && ORDER_LIST_TYPES.has(orderType)) query = query.eq('order_type', orderType);
    if (paymentMethod && ORDER_LIST_PAYMENT_METHODS.has(paymentMethod)) {
      const method =
        paymentMethod === 'credit_card' ? 'credit' : paymentMethod;
      query = query.eq('payment_method', method);
    }
    if (dateRange) {
      query = query.gte('ordered_at', dateRange.startIso).lte('ordered_at', dateRange.endIso);
    }
    if (search) {
      const safe = search.replace(/[%_*]/g, '').slice(0, 64);
      if (safe) {
        query = query.or(`order_number.ilike.%${safe}%,queue_number.ilike.%${safe}%`);
      }
    }
    if (activeOnly) query = query.not('status', 'in', '("completed","cancelled","voided","merged")');

    const { data, error } = await query;
    if (error) throw error;

    const orderRows = (data || []) as PosOrderRow[];
    const checkoutIds = Array.from(
      new Set(
        orderRows
          .map((order) => order.checkout_id)
          .filter((value): value is string => typeof value === 'string' && isUuid(value))
      )
    );
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
    let checkoutById = new Map<string, CheckoutStamp>();
    if (checkoutIds.length > 0) {
      const { data: checkouts, error: checkoutError } = await db
        .from('pos_checkouts')
        .select(
          'id, checkout_number, queue_number, payment_status, payment_method, payment_method_code, payment_method_name, total_amount, created_at'
        )
        .in('id', checkoutIds);
      if (checkoutError) throw checkoutError;
      checkoutById = new Map(
        ((checkouts || []) as CheckoutStamp[]).map((row) => [String(row.id), row])
      );
    }

    if (dateRange && !activeOnly && !customerId) {
      let orphanQuery = db
        .from('pos_checkouts')
        .select(
          'id, checkout_number, queue_number, payment_status, payment_method, payment_method_code, payment_method_name, total_amount, created_at'
        )
        .gte('created_at', dateRange.startIso)
        .lte('created_at', dateRange.endIso)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (paymentStatus && ORDER_LIST_PAYMENT_STATUSES.has(paymentStatus)) {
        orphanQuery = orphanQuery.eq('payment_status', paymentStatus);
      }
      if (paymentMethod && ORDER_LIST_PAYMENT_METHODS.has(paymentMethod)) {
        const method = paymentMethod === 'credit_card' ? 'credit' : paymentMethod;
        orphanQuery = orphanQuery.eq('payment_method', method);
      }
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

    const tableIds = Array.from(
      new Set(
        orderRows
          .map((order) => order.table_id)
          .filter((value): value is string => typeof value === 'string' && isUuid(value))
      )
    );
    let tableById = new Map<string, { table_number?: string | null; qr_code?: string | null }>();
    if (tableIds.length > 0) {
      const { data: tables, error: tableError } = await db
        .from('pos_tables')
        .select('id, table_number, qr_code')
        .in('id', tableIds);

      if (tableError) throw tableError;
      tableById = new Map(
        ((tables || []) as PosTableRow[]).map((table) => [
          String(table.id),
          { table_number: table.table_number, qr_code: table.qr_code },
        ])
      );
    }

    // EPIC-041 lanjutan (temuan owner: "Stall: —"): nama stall per order —
    // satu query untuk semua warehouse unik, dilekatkan ke tiap baris. Tagihan
    // gabungan multi-stall menampilkan stall lewat order anaknya masing-masing.
    const stallIds = Array.from(
      new Set(
        orderRows
          .map((order) => order.warehouse_id)
          .filter((value): value is string => typeof value === 'string' && isUuid(value))
      )
    );
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

    const ordersWithTables = orderRows.map((order) => {
      const checkout =
        typeof order.checkout_id === 'string' ? checkoutById.get(order.checkout_id) : null;
      const stall =
        typeof order.warehouse_id === 'string' ? stallById.get(order.warehouse_id) : null;
      return {
        ...order,
        checkout_number: checkout?.checkout_number || order.checkout_number || null,
        table: order.table_id ? tableById.get(order.table_id) || null : null,
        stall_name: stall?.name ?? null,
        stall_code: stall?.code ?? null,
      };
    });

    return NextResponse.json({ success: true, data: ordersWithTables });
  } catch (error: unknown) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

// POST /api/pos/orders — create new order via atomic RPC
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  // EPIC-039 Fase A — klaim stok merchandise yang harus dikembalikan bila
  // order gagal dibuat. Kosong = tidak ada yang perlu dikompensasi.
  let merchClaims: MerchStockClaim[] = [];

  try {
    const body = (await request.json()) as PosOrderBody;
    const {
      order_type = 'dine_in',
      customer_id,
      cashier_id,
      server_id,
      table_id,
      items = [],
      subtotal,
      discount_amount = 0,
      discount_reason,
      tax_amount = 0,
      service_charge_amount = 0,
      other_charges_amount = 0,
      charges_breakdown = [],
      total_amount,
      payment_method = 'cash',
      amount_paid = 0,
      notes,
      special_requests,
      ark_coins_used = 0,
      include_tax = false,
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: 'Items and total amount are required' }, { status: 400 });
    }
    const arkBlocked = await rejectIfArkCoinDisabled(payment_method === 'ark_coin' || Number(ark_coins_used) > 0);
    if (arkBlocked) return arkBlocked;

    const productIds = items.map((item) => String(item.product_id || ''));
    const warehouseByProduct = await loadPosProductWarehouseIds(productIds);
    const itemWarehouses = productIds.map((id) => warehouseByProduct.get(id) ?? null);
    const scope = await getApiUserScope();
    const gate = await loadCentralCashierGate({
      userId: sessionUserId,
      role: scope?.role ?? null,
    });
    const canSellMixed = canSellMixedStall({
      hasCentralMenu: gate.hasCentralMenu,
      canCentralCheckout: gate.canCentralCheckout,
      activeMode: gate.activeMode,
    });
    const mixedGuard = guardMixedCheckoutCart({
      productIds,
      warehouseByProduct,
      canSellMixed,
      hasSplits: Array.isArray(body.splits) && body.splits.length > 0,
      promoCode: body.promo_code,
    });
    if (!mixedGuard.ok) {
      return NextResponse.json({ success: false, error: mixedGuard.message }, { status: 400 });
    }
    if (mixedGuard.createCheckout) {
      const privilegeDb = createPgClient();
      const privilege = await checkProductPrivileges(
        privilegeDb,
        productIds,
        customer_id
      );
      if (!privilege.allowed) {
        return NextResponse.json(
          { success: false, error: privilege.message },
          { status: 403 }
        );
      }
      const result = await createMixedCheckout({
        items,
        warehouseByProduct,
        orderType: order_type,
        customerId: customer_id,
        cashierId: await resolveCashierId(sessionUserId, cashier_id),
        serverId: server_id,
        tableId: table_id,
        guestCount: body.guest_count,
        discountAmount: discount_amount,
        discountReason: discount_reason,
        promoCode: body.promo_code,
        taxAmount: tax_amount,
        serviceChargeAmount: service_charge_amount,
        otherChargesAmount: other_charges_amount,
        chargesBreakdown: charges_breakdown,
        totalAmount: total_amount,
        paymentMethod: payment_method,
        amountPaid: amount_paid,
        arkCoinsUsed: ark_coins_used,
        notes,
        specialRequests: special_requests,
        companyId: scope?.companyId,
        branchId: body.branch_id || scope?.branchId,
        shiftId: body.shift_id,
        sessionUserId,
        paymentMethodCode: body.payment_method_code,
        paymentMethodName: body.payment_method_name,
      });
      return NextResponse.json(
        {
          success: true,
          data: {
            checkout_id: result.checkoutId,
            checkout_number: result.checkoutNumber,
            queue_number: result.queueNumber,
            order_ids: result.orderIds,
          },
        },
        { status: 201 }
      );
    }
    const soldFrom = resolveOrderSoldFrom({
      isCentralCashier: gate.hasCentralMenu && gate.canCentralCheckout,
    });
    const singleStallFromAll = resolveSingleStallSellFromAllMode({
      itemWarehouses,
      canSellMixed,
    });

    let sellWarehouseId: string;
    if (singleStallFromAll) {
      const access = await getStallAccess(
        sessionUserId,
        scope?.role ?? null,
        scope?.branchId ?? null
      );
      const assigned = assertAllModeSellStallAssigned(
        singleStallFromAll,
        access.stalls.map((stall) => stall.id)
      );
      if (!assigned.ok) {
        return NextResponse.json({ success: false, error: assigned.message }, { status: 400 });
      }
      sellWarehouseId = singleStallFromAll;
    } else {
      const sellStall = await resolvePosSellStallForUser(sessionUserId);
      if (!sellStall.ok) {
        return NextResponse.json({ success: false, error: sellStall.message }, { status: 400 });
      }
      sellWarehouseId = sellStall.warehouseId;
    }

    const itemStallCheck = await assertOrderItemsMatchSellStall(
      productIds,
      sellWarehouseId
    );
    if (!itemStallCheck.ok) {
      return NextResponse.json({ success: false, error: itemStallCheck.message }, { status: 400 });
    }

    const effectiveCashierId = await resolveCashierId(sessionUserId, cashier_id);
    const splits = Array.isArray(body.splits) ? body.splits : [];

    const db = createPgClient();

    // Produk privilege (min_xp): tolak sebelum order dibuat — EPIC-011 Fase C
    const privilege = await checkProductPrivileges(
      db,
      items.map((item) => String(item.product_id || '')),
      customer_id
    );
    if (!privilege.allowed) {
      return NextResponse.json(
        { success: false, error: privilege.message },
        { status: 403 }
      );
    }

    // ── EPIC-034 Fase B — penjualan gift card ──────────────────────────
    // Nominal gift card DIKETIK kasir, jadi tidak dipercaya mentah: server
    // memuat ulang product_kind dari katalog dan memvalidasi tiap nominal ke
    // konfigurasi. Kartu baru terbit SETELAH order lunas (di bawah).
    const giftCardSale = await prepareGiftCardSale(items);
    if (!giftCardSale.ok) {
      return NextResponse.json(
        { success: false, error: giftCardSale.reason },
        { status: 400 }
      );
    }
    const giftCardNominals = giftCardSale.nominals;
    const sellsGiftCard = giftCardNominals.length > 0;

    // Split bill mode
    if (splits && splits.length > 0) {
      // EPIC-034 Fase B — penjualan gift card belum didukung utk split bill:
      // satu kartu tidak bisa dibagi ke beberapa pembayar (MVP, pola promo).
      if (sellsGiftCard) {
        return NextResponse.json(
          { success: false, error: 'Gift card belum didukung untuk split bill' },
          { status: 400 }
        );
      }
      // EPIC-032 C1 — promo belum didukung utk split bill (MVP)
      if (String(body.promo_code || '').trim()) {
        return NextResponse.json(
          { success: false, error: 'Kode promo belum didukung untuk split bill' },
          { status: 400 }
        );
      }
      // EPIC-039 Fase A — merchandise ber-stok belum didukung utk split bill:
      // jalur split memakai RPC lama yang tidak tahu deduksi stok merchandise
      // (MVP, pola gift card di atas).
      if (await hasTrackedMerchandise(db, items)) {
        return NextResponse.json(
          { success: false, error: 'Merchandise belum didukung untuk split bill' },
          { status: 400 }
        );
      }
      const rpcPayload = {
        p_order_type: order_type,
        p_customer_id: customer_id || null,
        p_cashier_id: effectiveCashierId,
        p_server_id: server_id || null,
        p_table_id: table_id || null,
        p_subtotal: Number(subtotal) || 0,
        p_discount_amount: Number(discount_amount) || 0,
        p_discount_reason: discount_reason || null,
        p_tax_amount: include_tax ? Number(tax_amount) || 0 : 0,
        p_service_charge_amount: Number(service_charge_amount) || 0,
        p_total_amount: Number(total_amount) || 0,
        p_notes: notes || null,
        p_special_requests: special_requests || null,
        p_items: items,
        p_splits: splits,
        p_branch_id: body.branch_id || null,
      };

      const { data: rpcResult, error: rpcError } = await db.rpc(
        'pos_create_split_order_transaction',
        rpcPayload
      );
      if (rpcError) {
        console.error('RPC split error:', rpcError);
        return NextResponse.json({ success: false, error: rpcError.message }, { status: 500 });
      }
      const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
      if (!result?.success) {
        return NextResponse.json({ success: false, error: result?.error || 'Split order creation failed' }, { status: 400 });
      }

      // Link shift if provided
      if (body.shift_id) {
        await db.from('pos_orders').update({ shift_id: body.shift_id }).eq('id', result.order_id);
      }

      // Jumlah tamu di-set setelah RPC, mengikuti pola shift_id di atas —
      // RPC `pos_create_split_order_transaction` punya signature tetap dan
      // mengubahnya berarti migrasi function. Tanpa ini, justru split bill
      // (yang hampir pasti banyak orang) akan tercatat 1 tamu karena DEFAULT
      // kolomnya.
      await db
        .from('pos_orders')
        .update({ guest_count: normalizeGuestCount(body.guest_count) })
        .eq('id', result.order_id);

      const venueForSplit = await getCrmDefaultVenue(db);
      await db
        .from('pos_orders')
        .update({
          company_id: venueForSplit.companyId,
          branch_id: body.branch_id || venueForSplit.branchId,
          warehouse_id: sellWarehouseId,
          sold_from: soldFrom,
        })
        .eq('id', result.order_id);
      await ensureQueueNumber(db, {
        id: result.order_id,
        company_id: venueForSplit.companyId,
        branch_id: body.branch_id || venueForSplit.branchId,
      });
      await backfillMissingItemStations(db, result.order_id);

      // Fetch complete order with relations
      const { data: completeOrder } = await db
        .from('pos_orders')
        .select(`*, customer:pos_customers(name, phone), items:pos_order_items(*), splits:pos_order_splits(*)`)
        .eq('id', result.order_id)
        .single();

      return NextResponse.json({
        success: true,
        data: completeOrder || result,
      }, { status: 201 });
    }

    // Single-payment flow
    // Avoid the old DB RPC because some deployed databases still have p_order_type TEXT
    // inserted into pos_order_type enum without casting.
    const venue = await getCrmDefaultVenue(db);
    const { data: orderNumData, error: orderNumErr } = await db.rpc('generate_order_number');
    if (orderNumErr) {
      return NextResponse.json({ success: false, error: orderNumErr.message }, { status: 500 });
    }

    const orderNumber = typeof orderNumData === 'string' ? orderNumData : String(orderNumData);
    const queueNumber = await allocateQueueNumber(
      db,
      venue.companyId,
      body.branch_id || venue.branchId
    );
    const serverSubtotal = items.reduce((sum: number, item: PosOrderItemRequest) => {
      const qty = Number(item.quantity) || 1;
      const unit = Number(item.unit_price) || 0;
      const variantAdj = Number(item.variant_price_adjustment) || 0;
      const modifierAdj = Number(item.modifier_price_adjustment) || 0;
      return sum + ((unit + variantAdj + modifierAdj) * qty);
    }, 0);
    const clientDiscount = Number(discount_amount) || 0;
    let discountReasonFinal: string | null = discount_reason || null;
    const serverTax = Number(tax_amount) || 0;
    const serverServiceCharge = Number(service_charge_amount) || 0;
    const serverOtherCharges = Number(other_charges_amount) || 0;
    const serverChargesBreakdown = Array.isArray(charges_breakdown) ? charges_breakdown : [];

    const parseDiscountType = (raw: unknown): DiscountType | null =>
      raw === 'percent' || raw === 'fixed' ? raw : null;

    const lineInputs = items.map((item: PosOrderItemRequest) => {
      const qty = Number(item.quantity) || 1;
      const unit = Number(item.unit_price) || 0;
      const variantAdj = Number(item.variant_price_adjustment) || 0;
      const modifierAdj = Number(item.modifier_price_adjustment) || 0;
      return {
        line_subtotal: (unit + variantAdj + modifierAdj) * qty,
        discount_type: parseDiscountType(item.discount_type),
        discount_value:
          item.discount_value == null || item.discount_value === ''
            ? null
            : Number(item.discount_value),
      };
    });

    const membershipPct = Number(body.membership_discount_pct) || 0;
    const manualType = parseDiscountType(body.manual_discount_type);
    const manualValue =
      body.manual_discount_value == null || body.manual_discount_value === ''
        ? null
        : Number(body.manual_discount_value);

    // Kode kasir = kode pembuka penawaran ATAU kode campaign promo.
    const enteredCode = String(body.promo_code || '').trim();
    const offerEval = await evaluateActiveOffersForPosCart({
      companyId: venue.companyId,
      branchId: body.branch_id || venue.branchId,
      code: enteredCode || null,
      customerId: customer_id || null,
      items: items.map((item: PosOrderItemRequest) => {
        const qty = Number(item.quantity) || 1;
        const unit = Number(item.unit_price) || 0;
        const variantAdj = Number(item.variant_price_adjustment) || 0;
        const modifierAdj = Number(item.modifier_price_adjustment) || 0;
        return {
          productId: String(item.product_id || ''),
          quantity: qty,
          unitPrice: unit + variantAdj + modifierAdj,
        };
      }),
    });
    const offerDiscountRaw = offerEval.offer_discount;

    // ── EPIC-032 C1 — kode promo kasir ─────────────────────────────
    // Hold DI AWAL dgn id order yang di-generate sendiri (insert pakai id
    // eksplisit) supaya kuota terkunci sebelum uang diterima; diskon =
    // turunan SERVER (line + offer + membership + promo + manual), klien
    // hanya diverifikasi. Gagal lolos → 422 sebelum ada baris order.
    const promoCode = offerEval.unlocked_rule_id ? '' : enteredCode;
    let promoHold: PromoHold | null = null;
    let promoOrderId: string | null = null;
    let promoDiscountRaw = 0;

    const provisionalStack = computeOrderDiscountStack({
      items: lineInputs,
      offer_discount: offerDiscountRaw,
      membership_pct: membershipPct,
      promo_discount: 0,
      manual_discount_type: manualType,
      manual_discount_value: manualValue,
    });
    const promoHoldSubtotal = provisionalStack.items_subtotal;

    if (promoCode) {
      const promoCompanyId = venue.companyId;
      const promoBranchId = body.branch_id || venue.branchId;
      if (!promoCompanyId || !promoBranchId) {
        return NextResponse.json(
          { success: false, error: 'Venue belum dikonfigurasi — kode promo tidak bisa dipakai' },
          { status: 400 }
        );
      }
      const promoScope = { companyId: promoCompanyId, branchId: promoBranchId };
      promoOrderId = randomUUID();
      try {
        promoHold = await withTransaction((client) =>
          holdPromoRedemption(client, {
            scope: promoScope,
            code: promoCode,
            channel: 'pos',
            contextType: 'pos_order',
            contextId: promoOrderId!,
            subtotal: promoHoldSubtotal,
            phone: null,
            customerId: customer_id || null,
            lines: items.map((item: PosOrderItemRequest, index: number) => ({
              productId: String(item.product_id || ''),
              amount: provisionalStack.line_results[index]?.total_amount ?? 0,
            })),
          })
        );
        promoDiscountRaw = promoHold.discount;
      } catch (promoErr) {
        if (promoErr instanceof PromoRejectedError) {
          return NextResponse.json(
            { success: false, error: promoErr.message },
            { status: 422 }
          );
        }
        throw promoErr;
      }
    }

    const stack = computeOrderDiscountStack({
      items: lineInputs,
      offer_discount: offerDiscountRaw,
      membership_pct: membershipPct,
      promo_discount: promoDiscountRaw,
      manual_discount_type: manualType,
      manual_discount_value: manualValue,
    });
    const serverDiscount = stack.discount_amount;

    if (Math.abs(clientDiscount - serverDiscount) > 1) {
      if (promoOrderId) {
        await withTransaction((client) =>
          releasePromoRedemption(client, 'pos_order', promoOrderId!)
        ).catch(() => {});
      }
      return NextResponse.json(
        {
          success: false,
          error: 'Total diskon tidak cocok — muat ulang dan coba lagi',
        },
        { status: 400 }
      );
    }

    // Kuota penawaran dikunci sebelum order dibuat (held; lunas → captured).
    const presetOrderId =
      promoOrderId ?? (offerEval.applied.length > 0 ? randomUUID() : null);
    if (presetOrderId && offerEval.applied.length > 0) {
      try {
        await withTransaction((client) =>
          recordOfferUsage(client, {
            companyId: venue.companyId,
            branchId: body.branch_id || venue.branchId,
            orderId: presetOrderId,
            customerId: customer_id || null,
            applied: offerEval.applied,
            status: 'held',
            enforce: true,
          })
        );
      } catch (offerErr) {
        if (!(offerErr instanceof OfferCapReachedError)) throw offerErr;
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        return NextResponse.json({ success: false, error: offerErr.message }, { status: 422 });
      }
    }

    discountReasonFinal = buildDiscountReason({
      has_item_discounts: stack.line_discount_total > 0,
      offer_labels: offerEval.applied.map((a) => a.name),
      membership_pct: membershipPct,
      promo_code: promoCode || null,
      manual_type: manualType,
      manual_value: manualValue,
    });

    const serverDerivedTotal =
      serverSubtotal - serverDiscount + serverTax + serverServiceCharge + serverOtherCharges;
    // NFC Tab (EPIC-023 Fase C): order lunas secara kasir, tagihannya pindah
    // ke tab visit ticketing — tidak ada uang diterima di sini. Nominal yang
    // masuk ledger tab WAJIB turunan server, bukan total_amount kiriman klien.
    // Order ber-promo juga WAJIB turunan server (klien tak dipercaya).
    const isNfcTab = payment_method === 'nfc_tab';
    // EPIC-034 Fase C — bayar dgn saldo gift card: nominal debit WAJIB
    // turunan server (uang titipan tamu), persis alasan yang sama dgn NFC Tab.
    const payWithGiftCard = payment_method === 'gift_card';
    const serverTotal = isNfcTab || payWithGiftCard || promoHold
      ? serverDerivedTotal
      : Number(total_amount) || serverDerivedTotal;
    const paidAmount = Number(amount_paid) || 0;
    const arkUsed = Number(ark_coins_used) || 0;
    const nfcTabUid = String(body.nfc_tab_uid || '').trim();
    const giftCardCode = String(body.gift_card_code || '').trim().toUpperCase();

    if (isNfcTab) {
      const rate = checkRateLimit(`pos-nfc-tab:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan NFC Tab — tunggu sebentar' },
          { status: 429 }
        );
      }
    }
    if (isNfcTab && !nfcTabUid) {
      return NextResponse.json(
        { success: false, error: 'Pembayaran NFC Tab membutuhkan tap gelang' },
        { status: 400 }
      );
    }
    if (isNfcTab && !isValidNfcUid(normalizeNfcUid(nfcTabUid))) {
      return NextResponse.json(
        { success: false, error: 'UID gelang tidak valid — tap ulang gelang' },
        { status: 400 }
      );
    }
    if (isNfcTab && arkUsed > 0) {
      return NextResponse.json(
        { success: false, error: 'NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
        { status: 400 }
      );
    }

    // ── EPIC-034 Fase C — guard pembayaran gift card ───────────────────
    if (payWithGiftCard) {
      const rate = checkRateLimit(`pos-gift-card:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan gift card — tunggu sebentar' },
          { status: 429 }
        );
      }
      if (!giftCardCode) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran gift card membutuhkan kode kartu' },
          { status: 400 }
        );
      }
      if (arkUsed > 0) {
        return NextResponse.json(
          { success: false, error: 'Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
          { status: 400 }
        );
      }
      if (!venue.companyId || !venue.branchId) {
        return NextResponse.json(
          { success: false, error: 'Venue belum dikonfigurasi — gift card tidak bisa dipakai' },
          { status: 400 }
        );
      }
    }
    // Saldo titipan/loyalitas tidak boleh dipakai MEMBELI saldo titipan baru
    // (gift card beli gift card = uang berputar tanpa kas masuk).
    if (sellsGiftCard && (payWithGiftCard || isNfcTab || payment_method === 'ark_coin')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Gift card harus dibeli dengan pembayaran tunai/kartu/QRIS, bukan saldo',
        },
        { status: 400 }
      );
    }

    if (payment_method === 'qris') {
      const qrisId = sanitizeXenditRef(body.xendit_qr_id);
      const qrisExternalId = sanitizeXenditRef(body.xendit_external_id);
      let qrisAlreadyUsed = false;
      if (qrisId || qrisExternalId) {
        let usedQuery = db
          .from('pos_orders')
          .select('id')
          .eq('payment_status', 'paid')
          .limit(1);
        usedQuery = qrisId
          ? usedQuery.eq('xendit_qr_id', qrisId)
          : usedQuery.eq('xendit_external_id', qrisExternalId);
        const { data: usedRow } = await usedQuery.maybeSingle();
        qrisAlreadyUsed = Boolean(usedRow);
      }
      const qrisGate = assertQrisSaleMaySettle({
        paymentMethod: payment_method,
        xenditQrId: qrisId,
        xenditExternalId: qrisExternalId,
        alreadyUsedByPaidOrder: qrisAlreadyUsed,
      });
      if (!qrisGate.ok) {
        return NextResponse.json({ success: false, error: qrisGate.message }, { status: 400 });
      }
    }


    // Metode FOC (Free of Charge) — keputusan owner 2026-08-24: penjualan
    // dengan metode FOC wajib disetujui PIN supervisor; penyetuju dicatat.
    let focApprover: { id: string; name: string } | null = null;
    if (isFocPaymentMethod(body.payment_method_code, body.payment_method_name)) {
      // Keputusan owner 2026-08-24: FOC WAJIB ber-customer/member — komplimen
      // tanpa identitas penerima tidak boleh tercatat.
      if (!customer_id) {
        return NextResponse.json(
          { success: false, error: 'Metode FOC membutuhkan customer/member — pilih customer dulu' },
          { status: 400 }
        );
      }
      const pin = String(body.supervisor_pin || '').trim();
      if (!pin) {
        return NextResponse.json(
          { success: false, error: 'Metode FOC membutuhkan PIN supervisor' },
          { status: 400 }
        );
      }
      focApprover = await verifySupervisorPinServer(pin);
      if (!focApprover) {
        return NextResponse.json(
          { success: false, error: 'PIN supervisor tidak valid' },
          { status: 403 }
        );
      }
    }

    if (!isNfcTab && !payWithGiftCard && !focApprover && paidAmount + arkUsed < serverTotal) {
      return NextResponse.json({ success: false, error: 'Payment insufficient' }, { status: 400 });
    }

    // 1 pembayaran = 1 metode (EPIC-011): ARK Coin tidak boleh dicampur metode
    // lain, dan pembayaran ARK Coin harus menutup seluruh total.
    if (arkUsed > 0 && payment_method !== 'ark_coin') {
      return NextResponse.json(
        { success: false, error: 'ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran' },
        { status: 400 }
      );
    }
    if (payment_method === 'ark_coin') {
      if (!customer_id) {
        return NextResponse.json({ success: false, error: 'Pembayaran ARK Coin membutuhkan customer' }, { status: 400 });
      }
      if (arkUsed < serverTotal) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran ARK Coin harus menutup seluruh total order' },
          { status: 400 }
        );
      }
    }

    // EPIC-043: komplimen KOL — gratis OTOMATIS utk customer bertanda is_kol,
    // divalidasi server (bukan kepercayaan ke kasir): customer wajib KOL,
    // kuota bulanan (bila diset) cukup, dan diskonnya menggratiskan SELURUH
    // order. owner_comp tidak lewat sini — hanya via pelunasan open bill.
    let compType: string | null = null;
    if (body.comp_type != null && String(body.comp_type) !== '') {
      const requested = String(body.comp_type);
      if (requested !== 'kol_comp') {
        return NextResponse.json(
          { success: false, error: 'comp_type tidak dikenal utk pembuatan order (owner_comp hanya via pelunasan open bill)' },
          { status: 400 }
        );
      }
      if (!customer_id) {
        return NextResponse.json(
          { success: false, error: 'Komplimen KOL membutuhkan customer' },
          { status: 400 }
        );
      }
      if (serverTotal > 0.5) {
        return NextResponse.json(
          { success: false, error: 'Komplimen KOL harus menggratiskan seluruh order (total 0)' },
          { status: 400 }
        );
      }
      const kol = await validateKolComp({ customerId: customer_id, grossIdr: serverSubtotal });
      if (!kol.ok) {
        return NextResponse.json({ success: false, error: kol.reason }, { status: 403 });
      }
      compType = 'kol_comp';
    }


    const payWithArk = arkUsed > 0 && Boolean(customer_id);
    // Order ARK/NFC Tab/Gift Card dibuat pending dulu; paid setelah
    // debit/charge sukses
    const deferPaid = payWithArk || isNfcTab || payWithGiftCard;

    // EPIC-039 Fase A — klaim stok merchandise SEBELUM order dibuat
    // (decrement atomik ber-guard di SQL; dua kasir memperebutkan stok
    // terakhir → satu gagal). Produk non-merchandise dilewati fungsi SQL.
    const merchClaimResult = await claimMerchandiseStock(db, items);
    if (!merchClaimResult.ok) {
      if (promoOrderId) {
        await withTransaction((client) =>
          releasePromoRedemption(client, 'pos_order', promoOrderId!)
        ).catch(() => {});
      }
      return NextResponse.json(
        { success: false, error: merchClaimResult.reason },
        { status: merchClaimResult.status }
      );
    }
    merchClaims = merchClaimResult.claims;
    const merchClaimedIds = new Set(merchClaims.map((claim) => claim.productId));

    const { data: insertedOrder, error: orderErr } = await db
      .from('pos_orders')
      .insert({
        ...(presetOrderId ? { id: presetOrderId } : {}),
        order_number: orderNumber,
        queue_number: queueNumber,
        order_type,
        status: 'pending',
        payment_status: deferPaid ? 'unpaid' : 'paid',
        company_id: venue.companyId,
        branch_id: body.branch_id || venue.branchId,
        warehouse_id: sellWarehouseId,
        customer_id: customer_id || null,
        cashier_id: effectiveCashierId,
        server_id: server_id || null,
        table_id: table_id || null,
        guest_count: normalizeGuestCount(body.guest_count),
        shift_id: body.shift_id || null,
        subtotal: serverSubtotal,
        discount_amount: serverDiscount,
        discount_reason: discountReasonFinal,
        manual_discount_type: manualType,
        manual_discount_value: manualValue,
        tax_amount: serverTax,
        service_charge_amount: serverServiceCharge,
        other_charges_amount: serverOtherCharges,
        charges_breakdown: serverChargesBreakdown,
        total_amount: serverTotal,
        amount_paid: paidAmount,
        change_amount: Math.max(0, paidAmount + arkUsed - serverTotal),
        payment_method,
        ark_coins_used: arkUsed,
        notes: notes || null,
        special_requests: special_requests || null,
        ordered_at: new Date().toISOString(),
        sold_from: soldFrom,
        xendit_qr_id: sanitizeXenditRef(body.xendit_qr_id),
        xendit_external_id: sanitizeXenditRef(body.xendit_external_id),
        ...resolvePaymentCatalogStamp({
          code: body.payment_method_code,
          name: body.payment_method_name,
        }),
        ...(compType ? { comp_type: compType } : {}),
        // FOC = komplimen: pendapatan diakui 0 — diskon 100% dari gross,
        // pajak/service digugurkan (tidak ada pembayaran), penyetuju dicatat.
        ...(focApprover
          ? {
              discount_amount: serverSubtotal,
              discount_reason: 'FOC',
              tax_amount: 0,
              service_charge_amount: 0,
              other_charges_amount: 0,
              total_amount: 0,
              amount_paid: 0,
              change_amount: 0,
              comp_type: 'foc_comp',
              comp_approved_by: focApprover.id,
              comp_approved_name: focApprover.name,
            }
          : {}),
      })
      .select()
      .single();

    // Satu binding orderData (insert → optional legacy fallback). Jangan redeclare.
    let orderData = insertedOrder;
    let orderInsertErr = orderErr;
    if (orderInsertErr?.code === '42703' || orderInsertErr?.code === 'PGRST204') {
      const legacyResult = await db
        .from('pos_orders')
        .insert({
          ...(promoOrderId ? { id: promoOrderId } : {}),
          order_number: orderNumber,
          queue_number: queueNumber,
          order_type,
          status: 'pending',
          payment_status: deferPaid ? 'unpaid' : 'paid',
          company_id: venue.companyId,
          branch_id: body.branch_id || venue.branchId,
          warehouse_id: sellWarehouseId,
          customer_id: customer_id || null,
          cashier_id: effectiveCashierId,
          server_id: server_id || null,
          table_id: table_id || null,
          guest_count: normalizeGuestCount(body.guest_count),
          shift_id: body.shift_id || null,
          subtotal: serverSubtotal,
          discount_amount: serverDiscount,
          discount_reason: discountReasonFinal,
          tax_amount: serverTax,
          service_charge_amount: serverServiceCharge,
          other_charges_amount: serverOtherCharges,
          charges_breakdown: serverChargesBreakdown,
          total_amount: serverTotal,
          amount_paid: paidAmount,
          change_amount: Math.max(0, paidAmount + arkUsed - serverTotal),
          payment_method,
          ark_coins_used: arkUsed,
          notes: notes || null,
          special_requests: special_requests || null,
          ordered_at: new Date().toISOString(),
        })
        .select()
        .single();
      orderData = legacyResult.data;
      orderInsertErr = legacyResult.error;
    }

    if (orderInsertErr || !orderData) {
      console.error('Order insert error:', orderInsertErr);
      await restoreMerchandiseStock(db, merchClaims);
      merchClaims = [];
      if (promoOrderId) {
        await withTransaction((client) =>
          releasePromoRedemption(client, 'pos_order', promoOrderId!)
        ).catch(() => {});
      }
      return NextResponse.json({ success: false, error: orderInsertErr?.message || 'Failed to create order' }, { status: 500 });
    }

    // Notifikasi WA owner (2026-08-24): setiap FOC yang disetujui dikabarkan.
    if (focApprover) {
      void notifyCompTransaction({
        compType: 'foc_comp',
        orderNumber,
        grossIdr: serverSubtotal,
        approvedName: focApprover.name,
        customerId: customer_id || null,
      });
    }

    // Debit saldo ARK atomik (fix bug: checkout langsung sebelumnya tidak
    // pernah memotong saldo). Gagal debit → order dibatalkan, bukan paid.
    // Charge tab ticketing + tandai order paid dalam SATU transaksi DB
    // (lock visit + guard saldo/plafon di dalamnya) — charge dan status
    // order tidak mungkin terpisah. Gagal charge → order dibatalkan.
    if (isNfcTab) {
      const tabResult = await chargeFnbOrderToTab({
        orderId: orderData.id,
        orderNumber,
        amount: serverTotal,
        bandUid: nfcTabUid,
        companyId: venue.companyId,
        branchId: body.branch_id || venue.branchId,
        createdBy: sessionUserId,
        markOrderPaid: true,
      });

      if (!tabResult.ok) {
        // Jejak audit sebelum order kompensasi dihapus (percobaan gagal
        // tidak meninggalkan baris DB)
        console.error(
          `[pos] nfc_tab charge rejected: order=${orderData.id} user=${sessionUserId} reason=${tabResult.reason}`
        );
        await restoreMerchandiseStock(db, merchClaims);
        merchClaims = [];
        const { error: delErr } = await db
          .from('pos_orders')
          .delete()
          .eq('id', orderData.id);
        if (delErr) {
          console.error(
            `[pos] nfc_tab compensation delete failed: order=${orderData.id}:`,
            delErr
          );
          // Jangan biarkan order zombie pending nongol di daftar aktif kasir
          await db
            .from('pos_orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', orderData.id);
        }
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        return NextResponse.json(
          { success: false, error: tabResult.reason },
          { status: tabResult.status === 402 ? 400 : tabResult.status }
        );
      }

      orderData.status = 'pending';
      orderData.payment_status = 'paid';
    }

    // EPIC-034 Fase C — debit saldo gift card. Kartu dikunci FOR UPDATE di
    // dalam transaksinya sendiri (dua kasir memakai kartu yang sama tidak
    // bisa membuat saldo minus). Gagal debit → order dikompensasi, bukan paid.
    const giftCardScope = {
      companyId: venue.companyId as string,
      branchId: (body.branch_id || venue.branchId) as string,
    };
    if (payWithGiftCard) {
      const redeem = await redeemGiftCardForPosOrder({
        scope: giftCardScope,
        code: giftCardCode,
        amount: serverTotal,
        orderId: orderData.id,
        createdBy: sessionUserId,
      });

      if (!redeem.ok) {
        // Jejak audit sebelum order kompensasi dihapus
        console.error(
          `[pos] gift_card debit rejected: order=${orderData.id} user=${sessionUserId} reason=${redeem.reason}`
        );
        await restoreMerchandiseStock(db, merchClaims);
        merchClaims = [];
        const { error: delErr } = await db
          .from('pos_orders')
          .delete()
          .eq('id', orderData.id);
        if (delErr) {
          console.error(
            `[pos] gift_card compensation delete failed: order=${orderData.id}:`,
            delErr
          );
          await db
            .from('pos_orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', orderData.id);
        }
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        return NextResponse.json(
          { success: false, error: redeem.reason },
          { status: redeem.status === 409 ? 409 : redeem.status === 404 ? 404 : 400 }
        );
      }

      const { error: markPaidErr } = await db
        .from('pos_orders')
        .update({
          payment_status: 'paid',
        })
        .eq('id', orderData.id);
      if (markPaidErr) {
        // Saldo sudah terpotong tapi order tak bisa ditandai lunas →
        // kembalikan saldo (keputusan owner 27 Jul: kompensasi otomatis).
        await refundGiftCardForPosOrder({
          scope: giftCardScope,
          orderId: orderData.id,
          createdBy: sessionUserId,
          note: 'Pengembalian saldo — order gagal ditandai lunas',
        }).catch((err) =>
          console.error(`[pos] gift_card refund failed: order=${orderData.id}:`, err)
        );
        throw markPaidErr;
      }
      orderData.status = 'pending';
      orderData.payment_status = 'paid';
    }

    // EPIC-041 task 1: RPC mengembalikan saldo SETELAH potong — snapshot ini
    // dibawa ke respons utk dicetak di struk. Bukan query terpisah: saldo bisa
    // berubah oleh transaksi lain di sela-selanya.
    let arkBalanceAfter: number | null = null;
    if (payWithArk) {
      const { data: coinBalance, error: coinError } = await db.rpc('update_ark_coin_balance', {
        p_customer_id: customer_id,
        p_amount: -arkUsed,
        p_type: 'payment',
        p_order_id: orderData.id,
      });

      if (coinError) {
        await restoreMerchandiseStock(db, merchClaims);
        merchClaims = [];
        await db.from('pos_orders').delete().eq('id', orderData.id);
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        const insufficient = coinError.message?.includes('Insufficient');
        return NextResponse.json(
          { success: false, error: insufficient ? 'Saldo ARK Coin tidak cukup' : 'Gagal memproses ARK Coin' },
          { status: 400 }
        );
      }

      arkBalanceAfter = Number(coinBalance);
      if (!Number.isFinite(arkBalanceAfter)) arkBalanceAfter = null;

      const { error: markPaidErr } = await db
        .from('pos_orders')
        .update({
          payment_status: 'paid',
        })
        .eq('id', orderData.id);
      if (markPaidErr) throw markPaidErr;
      orderData.status = 'pending';
      orderData.payment_status = 'paid';
    }

    const productCostMap = await loadPosProductCostMap(
      db,
      items.map((item) => String(item.product_id || '')).filter(Boolean)
    );

    // SKU bermakna sejak disimpan (owner 2026-09-04): kode master / sku POS,
    // bukan UUID product_id. Satu query batch per order.
    const skuByProduct = new Map(
      (await resolveOrderItemSkus(db, items.map((it: { product_id?: string | null; product_sku?: string | null }) => ({ product_id: it.product_id, product_sku: it.product_sku }))))
        .map((it) => [String(it.product_id), it.product_sku] as const)
    );

    const orderItems = items.map((item: PosOrderItemRequest, index: number) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice =
        (Number(item.unit_price) || 0) +
        (Number(item.variant_price_adjustment) || 0) +
        (Number(item.modifier_price_adjustment) || 0);
      const subtotalValue = unitPrice * qty;
      const line = stack.line_results[index];
      const lineDiscount = line?.discount_amount ?? 0;
      const lineTotal = line?.total_amount ?? subtotalValue;
      const costSnapshot = buildCostSnapshot(
        item.product_id ? productCostMap.get(item.product_id) : undefined,
        qty,
        lineTotal
      );
      const discType = parseDiscountType(item.discount_type);
      const discValue =
        item.discount_value == null || item.discount_value === ''
          ? null
          : Number(item.discount_value);

      return {
        order_id: orderData.id,
        product_id: item.product_id,
        sku_id: item.sku_id || null,
        product_name: item.product_name || 'Unknown',
        product_sku: String(skuByProduct.get(String(item.product_id)) || item.product_sku || item.product_id || '').slice(0, 50),
        variants: item.variants || [],
        modifiers: item.modifiers || [],
        quantity: qty,
        unit_price: unitPrice,
        subtotal: subtotalValue,
        discount_type: discType,
        discount_value: discValue,
        discount_amount: lineDiscount,
        total_amount: lineTotal,
        xp_earned: 0,
        station: normalizeStation(
          item.station,
          String(item.product_name || ''),
          ''
        ),
        kitchen_status: 'pending',
        // EPIC-039 Fase A — true untuk baris merchandise yang stoknya sudah
        // diklaim di atas; dipakai restore saat order dibatalkan.
        inventory_deducted: item.product_id
          ? merchClaimedIds.has(String(item.product_id))
          : false,
        ...costSnapshot,
      };
    });

    let { error: itemsErr } = await db.from('pos_order_items').insert(orderItems);
    if (itemsErr?.code === '42703' || itemsErr?.code === 'PGRST204') {
      const legacyItems = orderItems.map((item) => {
        const legacyItem = { ...item } as Partial<typeof item>;
        delete legacyItem.station;
        delete legacyItem.kitchen_status;
        delete legacyItem.sku_id;
        delete legacyItem.cost_price;
        delete legacyItem.cost_total;
        delete legacyItem.gross_profit;
        delete legacyItem.gross_margin_pct;
        delete legacyItem.discount_type;
        delete legacyItem.discount_value;
        return legacyItem;
      });
      const legacyResult = await db.from('pos_order_items').insert(legacyItems);
      itemsErr = legacyResult.error;
    }
    if (itemsErr) {
      console.error('Order items insert error:', itemsErr);
      await restoreMerchandiseStock(db, merchClaims);
      merchClaims = [];
      // EPIC-034 Fase C — saldo sudah terpotong tapi order tak lengkap →
      // kembalikan saldo tamu (kompensasi otomatis, idempoten).
      if (payWithGiftCard) {
        await refundGiftCardForPosOrder({
          scope: giftCardScope,
          orderId: orderData.id,
          createdBy: sessionUserId,
          note: 'Pengembalian saldo — baris order gagal disimpan',
        }).catch((err) =>
          console.error(`[pos] gift_card refund failed: order=${orderData.id}:`, err)
        );
      }
      return NextResponse.json({ success: false, error: itemsErr.message }, { status: 500 });
    }

    // Baris order tersimpan — stok merchandise resmi milik order ini.
    // Pembatalan setelah titik ini dikembalikan lewat jalur cancel/void
    // (restoreMerchandiseStockForOrder), bukan kompensasi catch.
    merchClaims = [];

    await db.from('pos_order_status_history').insert({
      order_id: orderData.id,
      from_status: null,
      to_status: 'pending',
      changed_by: effectiveCashierId,
      notes: deferPaid
        ? 'Order created from cashier'
        : 'Order created and paid from cashier',
    });

    const printJobs = buildKitchenPrintJobs(
      { ...orderData, queue_number: queueNumber },
      orderItems
    );
    if (printJobs.length > 0) {
      const { error: printJobError } = await db
        .from('pos_print_jobs')
        .insert(printJobs);
      if (printJobError && printJobError.code !== '42P01' && printJobError.code !== 'PGRST205') {
        console.warn('Checkout print jobs warning:', printJobError.message);
      }
    }

    // FOC: total tersimpan 0 — statistik belanja & XP ikut 0 (komplimen
    // bukan belanja customer).
    const settledTotal = focApprover ? 0 : serverTotal;

    // Statistik kunjungan/belanja untuk semua metode pembayaran
    if (customer_id) {
      await syncPosCustomerOrderStats(db, customer_id, settledTotal);
    }

    const crmXp = await awardCrmXpForPosOrder(db, {
      orderId: orderData.id,
      customerId: customer_id || null,
      totalAmount: settledTotal,
      items: orderItems,
      outletId: body.branch_id || venue.branchId,
      paymentMethod: payment_method,
    });

    // EPIC-041 task 2: total XP member SETELAH award, utk baris "Total XP"
    // di struk. XP transaksinya sendiri dibawa via crm_xp.xpAwarded — TIDAK
    // ditulis ke pos_orders: tabel itu tidak punya kolom xp_earned (catatan
    // XP per order hidup di pos_xp_transactions).
    let xpTotalAfter: number | null = null;
    if (customer_id) {
      const { data: xpCustomer } = await db
        .from('pos_customers')
        .select('total_xp')
        .eq('id', customer_id)
        .maybeSingle();
      const totalXp = Number((xpCustomer as { total_xp?: unknown } | null)?.total_xp);
      xpTotalAfter = Number.isFinite(totalXp) ? totalXp : null;
    }

    // ── EPIC-034 Fase B — kartu terbit setelah order LUNAS ─────────────
    // Idempoten per order (retry tidak menggandakan kartu). Gagal terbit
    // TIDAK membatalkan order yang sudah dibayar — kasir diberi peringatan
    // keras supaya kasusnya ditangani admin, bukan hilang diam-diam.
    let giftCardsIssued: IssuedGiftCard[] = [];
    let giftCardIssueError: string | null = null;
    if (sellsGiftCard) {
      const buyerName = String(body.gift_card_buyer_name || '').trim() || null;
      const buyerPhone = String(body.gift_card_buyer_phone || '').trim() || null;
      try {
        giftCardsIssued = await issueGiftCardsForPosOrder({
          scope: giftCardScope,
          orderId: orderData.id,
          nominals: giftCardNominals,
          buyerName,
          buyerPhone,
          createdBy: sessionUserId,
        });
      } catch (giftErr) {
        console.error(
          `[pos] gift card issue failed: order=${orderData.id}:`,
          giftErr
        );
        giftCardIssueError =
          'Order LUNAS tapi kartu gagal terbit — catat nomor order dan hubungi admin';
      }

      // WA hanya tambahan; kode tetap tercetak di struk (keputusan owner).
      if (giftCardsIssued.length > 0 && buyerPhone) {
        void sendGiftCardSoldWa({
          buyerName,
          buyerPhone,
          cards: giftCardsIssued,
        }).catch((waErr) =>
          console.error(`[pos] gift card WA failed: order=${orderData.id}:`, waErr)
        );
      }
    }

    // Jurnal dulu, baru capture voucher — supaya gagal balance tidak
    // meninggalkan promo terpakai tanpa jejak jurnal yang jelas.
    let accountingNote: string | null = null;
    if (orderData.payment_status === 'paid') {
      const { postPosSaleAccountingJournals } = await import('@/lib/pos/accounting-posting');
      try {
        const accounting = await postPosSaleAccountingJournals({
          db,
          orderId: orderData.id,
          userId: sessionUserId,
          paymentMethod: payment_method,
        });
        accountingNote = accounting.note;
      } catch (err) {
        if (err instanceof AccountingPostError) {
          // Order sudah lunas; jangan gagalkan checkout. Catat untuk admin.
          console.error(`[pos] accounting post failed: order=${orderData.id}:`, err);
          accountingNote = err.message;
        } else {
          throw err;
        }
      }
    }

    // EPIC-032 C1 — order lunas → pemakaian kode FINAL (held → captured).
    // Void order melepasnya kembali (route void).
    if (promoOrderId) {
      await withTransaction((client) =>
        capturePromoRedemption(client, 'pos_order', promoOrderId!)
      ).catch((err) => console.error('[pos] capture promo error:', err));
    }
    if (presetOrderId && offerEval.applied.length > 0) {
      await withTransaction((client) => captureOfferUsage(client, presetOrderId)).catch(
        (err) => console.error('[pos] capture offer usage error:', err)
      );
    }

    const { data: completeOrder } = await db
      .from('pos_orders')
      .select(`*, customer:pos_customers(name, phone), items:pos_order_items(*)`)
      .eq('id', orderData.id)
      .single();

    return NextResponse.json(
      {
        success: true,
        data: completeOrder || orderData,
        crm_xp: crmXp,
        // EPIC-041: snapshot utk struk — saldo ARK setelah potong (Rupiah,
        // konversi ARK di klien via ark_rate) & total XP member setelah award.
        ark_balance_after: arkBalanceAfter,
        xp_total_after: xpTotalAfter,
        message: accountingNote || undefined,
        ...(sellsGiftCard
          ? { gift_cards: giftCardsIssued, gift_card_error: giftCardIssueError }
          : {}),
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (error instanceof AccountingPostError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    console.error('Error creating order:', error);
    if (merchClaims.length > 0) {
      // Error dilempar setelah stok diklaim (mis. markPaidErr) → kembalikan.
      await restoreMerchandiseStock(createPgClient(), merchClaims).catch((restoreErr) =>
        console.error('[pos] merch stock restore in catch failed:', restoreErr)
      );
      merchClaims = [];
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Kasir sebenarnya = karyawan milik SESI login, bukan input klien (EPIC-041
 * lanjutan, temuan owner: "Kasir: —" di semua order). Klien selama ini
 * mengirim id dummy 00000000-…-001 hardcode, jadi tidak pernah ada kasir
 * sungguhan tercatat. Urutan: karyawan sesi → cashier_id klien (bila bukan
 * dummy) → dummy sebagai upaya terakhir (kolomnya NOT NULL).
 */
const FALLBACK_CASHIER_ID = '00000000-0000-0000-0000-000000000001';

async function resolveCashierId(
  sessionUserId: string,
  clientCashierId?: string | null
): Promise<string> {
  const employee = await queryOne<{ id: string }>(
    `SELECT id FROM hris.employees WHERE user_id = $1 LIMIT 1`,
    [sessionUserId]
  ).catch(() => null);
  if (employee?.id) return employee.id;
  if (clientCashierId && clientCashierId !== FALLBACK_CASHIER_ID) return clientCashierId;
  return FALLBACK_CASHIER_ID;
}
