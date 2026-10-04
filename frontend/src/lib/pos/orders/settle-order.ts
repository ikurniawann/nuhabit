import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from '@/lib/crm/loyalty-engine';
import { withTransaction } from '@/lib/db';
import { sendGiftCardSoldWa } from '@/lib/giftcard/gift-card-wa';
import {
  issueGiftCardsForPosOrder,
  redeemGiftCardForPosOrder,
  refundGiftCardForPosOrder,
  type IssuedGiftCard,
} from '@/lib/giftcard/giftcard-server';
import { AccountingPostError } from '@/lib/pos/accounting-posting';
import { buildKitchenPrintJobs } from '@/lib/pos/kitchen-station';
import type { LineDiscountResult } from '@/lib/pos/manual-discount';
import { restoreMerchandiseStock } from '@/lib/pos/merchandise-stock';
import { resolveOrderItemSkus } from '@/lib/pos/order-item-sku';
import { loadPosProductCostMap } from '@/lib/pos/purchasing-sync';
import { capturePromoRedemption, releasePromoRedemption } from '@/lib/promo/promo-server';
import { captureOfferUsage } from '@/lib/promo/offer-rules-server';
import { chargeFnbOrderToTab } from '@/lib/ticketing/tab-server';
import { buildOrderItemRows, stripLegacyItemColumns } from './order-pricing';
import {
  orderError,
  type MerchClaimsRef,
  type OrderContext,
  type OrderResponse,
} from './order-types';

/** Lepas hold kode promo (best effort) saat order gagal dibuat/dibayar. */
export async function releasePromoHold(promoOrderId: string | null) {
  if (!promoOrderId) return;
  await withTransaction((client) =>
    releasePromoRedemption(client, 'pos_order', promoOrderId)
  ).catch(() => {});
}

/** Order yang sudah ter-insert (status pending), menunggu pelunasan & baris item. */
type PlacedOrder = {
  ctx: OrderContext;
  merch: MerchClaimsRef;
  order: { id: string; [key: string]: unknown };
  orderNumber: string;
  queueNumber: unknown;
  /** Venue order; gift card & NFC Tab sudah memastikan keduanya terisi. */
  scope: { companyId: string; branchId: string };
  total: number;
  arkUsed: number;
  payWithArk: boolean;
  deferPaid: boolean;
  nfcTabUid: string;
  giftCardCode: string;
  promoOrderId: string | null;
  /** Id order yang memegang kuota penawaran (held → captured saat lunas). */
  offerOrderId: string | null;
  lineResults: LineDiscountResult[];
  isFoc: boolean;
};

/**
 * Kompensasi order yang gagal dibayar: stok merchandise kembali, order dihapus,
 * hold promo dilepas. `label` diisi utk NFC Tab/gift card: gagal hapus →
 * order dibatalkan supaya tidak jadi order zombie pending di daftar aktif kasir.
 */
async function undoPlacedOrder(placed: PlacedOrder, label: 'nfc_tab' | 'gift_card' | null) {
  const { db } = placed.ctx;
  const orderId = placed.order.id;
  await restoreMerchandiseStock(db, placed.merch.claims);
  placed.merch.claims = [];
  const { error: delErr } = await db.from('pos_orders').delete().eq('id', orderId);
  if (delErr && label) {
    console.error(`[pos] ${label} compensation delete failed: order=${orderId}:`, delErr);
    await db
      .from('pos_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', orderId);
  }
  await releasePromoHold(placed.promoOrderId);
}

async function markOrderPaid(placed: PlacedOrder) {
  const { error } = await placed.ctx.db
    .from('pos_orders')
    .update({ payment_status: 'paid' })
    .eq('id', placed.order.id);
  return error;
}

/**
 * Pelunasan saldo (NFC Tab, gift card, ARK Coin). Gagal → order dikompensasi
 * dan respons error dikembalikan; sukses → order ditandai lunas.
 */
async function settleBalancePayment(
  placed: PlacedOrder
): Promise<{ ok: false; response: OrderResponse } | { ok: true; arkBalanceAfter: number | null }> {
  const { db, req, sessionUserId } = placed.ctx;
  const { order, scope, total } = placed;

  // Charge tab ticketing + tandai order paid dalam SATU transaksi DB (lock
  // visit + guard saldo/plafon di dalamnya): charge dan status order tidak
  // mungkin terpisah. Gagal charge → order dibatalkan.
  if (req.payment_method === 'nfc_tab') {
    const tabResult = await chargeFnbOrderToTab({
      orderId: order.id,
      orderNumber: placed.orderNumber,
      amount: total,
      bandUid: placed.nfcTabUid,
      companyId: scope.companyId,
      branchId: scope.branchId,
      createdBy: sessionUserId,
      markOrderPaid: true,
    });
    if (!tabResult.ok) {
      // Jejak audit sebelum order kompensasi dihapus
      console.error(
        `[pos] nfc_tab charge rejected: order=${order.id} user=${sessionUserId} reason=${tabResult.reason}`
      );
      await undoPlacedOrder(placed, 'nfc_tab');
      return {
        ok: false,
        response: orderError(tabResult.status === 402 ? 400 : tabResult.status, tabResult.reason),
      };
    }
    order.status = 'pending';
    order.payment_status = 'paid';
  }

  // EPIC-034 Fase C — debit saldo gift card. Kartu dikunci FOR UPDATE di
  // dalam transaksinya sendiri (dua kasir memakai kartu yang sama tidak bisa
  // membuat saldo minus). Gagal debit → order dikompensasi, bukan paid.
  if (req.payment_method === 'gift_card') {
    const redeem = await redeemGiftCardForPosOrder({
      scope,
      code: placed.giftCardCode,
      amount: total,
      orderId: order.id,
      createdBy: sessionUserId,
    });
    if (!redeem.ok) {
      console.error(
        `[pos] gift_card debit rejected: order=${order.id} user=${sessionUserId} reason=${redeem.reason}`
      );
      await undoPlacedOrder(placed, 'gift_card');
      const status = redeem.status === 409 ? 409 : redeem.status === 404 ? 404 : 400;
      return { ok: false, response: orderError(status, redeem.reason) };
    }
    const markPaidErr = await markOrderPaid(placed);
    if (markPaidErr) {
      // Saldo sudah terpotong tapi order tak bisa ditandai lunas → kembalikan
      // saldo (keputusan owner 27 Jul: kompensasi otomatis).
      await refundGiftCard(placed, 'Pengembalian saldo — order gagal ditandai lunas');
      throw markPaidErr;
    }
    order.status = 'pending';
    order.payment_status = 'paid';
  }

  // Debit saldo ARK atomik. EPIC-041 task 1: RPC mengembalikan saldo SETELAH
  // potong; snapshot ini dibawa ke respons utk struk (bukan query terpisah,
  // saldo bisa berubah oleh transaksi lain di sela-selanya).
  let arkBalanceAfter: number | null = null;
  if (placed.payWithArk) {
    const { data: coinBalance, error: coinError } = await db.rpc('update_ark_coin_balance', {
      p_customer_id: req.customer_id,
      p_amount: -placed.arkUsed,
      p_type: 'payment',
      p_order_id: order.id,
    });
    if (coinError) {
      await undoPlacedOrder(placed, null);
      const insufficient = coinError.message?.includes('Insufficient');
      return {
        ok: false,
        response: orderError(
          400,
          insufficient ? 'Saldo ARK Coin tidak cukup' : 'Gagal memproses ARK Coin'
        ),
      };
    }
    arkBalanceAfter = Number(coinBalance);
    if (!Number.isFinite(arkBalanceAfter)) arkBalanceAfter = null;

    const markPaidErr = await markOrderPaid(placed);
    if (markPaidErr) throw markPaidErr;
    order.status = 'pending';
    order.payment_status = 'paid';
  }
  return { ok: true, arkBalanceAfter };
}

function refundGiftCard(placed: PlacedOrder, note: string) {
  return refundGiftCardForPosOrder({
    scope: placed.scope,
    orderId: placed.order.id,
    createdBy: placed.ctx.sessionUserId,
    note,
  }).catch((err) => console.error(`[pos] gift_card refund failed: order=${placed.order.id}:`, err));
}

/** Lunasi saldo, simpan baris item, lalu efek lanjutan (XP, gift card, jurnal, promo). */
export async function settleAndCompleteOrder(placed: PlacedOrder): Promise<OrderResponse> {
  const settled = await settleBalancePayment(placed);
  if (!settled.ok) return settled.response;

  const { db, req, sessionUserId, cashierId, giftCardNominals } = placed.ctx;
  const { items, customer_id, payment_method } = req;
  const { order, merch } = placed;

  const costMap = await loadPosProductCostMap(
    db,
    items.map((item) => String(item.product_id || '')).filter(Boolean)
  );
  // SKU bermakna sejak disimpan (owner 2026-09-04): kode master / sku POS,
  // bukan UUID product_id. Satu query batch per order.
  const skuByProduct = new Map(
    (
      await resolveOrderItemSkus(
        db,
        items.map((it) => ({ product_id: it.product_id, product_sku: it.product_sku }))
      )
    ).map((it) => [String(it.product_id), it.product_sku] as const)
  );
  const orderItems = buildOrderItemRows({
    orderId: order.id,
    items,
    lineResults: placed.lineResults,
    costMap,
    skuByProduct,
    merchClaimedIds: new Set(merch.claims.map((claim) => claim.productId)),
  });

  let { error: itemsErr } = await db.from('pos_order_items').insert(orderItems);
  if (itemsErr?.code === '42703' || itemsErr?.code === 'PGRST204') {
    const legacyResult = await db
      .from('pos_order_items')
      .insert(stripLegacyItemColumns(orderItems));
    itemsErr = legacyResult.error;
  }
  if (itemsErr) {
    console.error('Order items insert error:', itemsErr);
    await restoreMerchandiseStock(db, merch.claims);
    merch.claims = [];
    // EPIC-034 Fase C — saldo sudah terpotong tapi order tak lengkap →
    // kembalikan saldo tamu (kompensasi otomatis, idempoten).
    if (payment_method === 'gift_card') {
      await refundGiftCard(placed, 'Pengembalian saldo — baris order gagal disimpan');
    }
    return orderError(500, itemsErr.message);
  }

  // Baris order tersimpan — stok merchandise resmi milik order ini.
  // Pembatalan setelah titik ini dikembalikan lewat jalur cancel/void
  // (restoreMerchandiseStockForOrder), bukan kompensasi catch.
  merch.claims = [];

  await db.from('pos_order_status_history').insert({
    order_id: order.id,
    from_status: null,
    to_status: 'pending',
    changed_by: cashierId,
    notes: placed.deferPaid ? 'Order created from cashier' : 'Order created and paid from cashier',
  });

  const printJobs = buildKitchenPrintJobs(
    { ...order, queue_number: placed.queueNumber },
    orderItems
  );
  if (printJobs.length > 0) {
    const { error: printJobError } = await db.from('pos_print_jobs').insert(printJobs);
    if (printJobError && printJobError.code !== '42P01' && printJobError.code !== 'PGRST205') {
      console.warn('Checkout print jobs warning:', printJobError.message);
    }
  }

  // FOC: total tersimpan 0 — statistik belanja & XP ikut 0 (komplimen bukan
  // belanja customer).
  const settledTotal = placed.isFoc ? 0 : placed.total;
  if (customer_id) {
    await syncPosCustomerOrderStats(db, customer_id, settledTotal);
  }
  const crmXp = await awardCrmXpForPosOrder(db, {
    orderId: order.id,
    customerId: customer_id || null,
    totalAmount: settledTotal,
    items: orderItems,
    outletId: placed.scope.branchId,
    paymentMethod: payment_method,
  });

  // EPIC-041 task 2: total XP member SETELAH award, utk baris "Total XP" di
  // struk. pos_orders tidak punya kolom xp_earned (XP per order hidup di
  // pos_xp_transactions).
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

  // EPIC-034 Fase B — kartu terbit setelah order LUNAS. Idempoten per order.
  // Gagal terbit TIDAK membatalkan order yang sudah dibayar; kasir diberi
  // peringatan keras supaya kasusnya ditangani admin.
  const sellsGiftCard = giftCardNominals.length > 0;
  let giftCardsIssued: IssuedGiftCard[] = [];
  let giftCardIssueError: string | null = null;
  if (sellsGiftCard) {
    const buyerName = String(req.gift_card_buyer_name || '').trim() || null;
    const buyerPhone = String(req.gift_card_buyer_phone || '').trim() || null;
    try {
      giftCardsIssued = await issueGiftCardsForPosOrder({
        scope: placed.scope,
        orderId: order.id,
        nominals: giftCardNominals,
        buyerName,
        buyerPhone,
        createdBy: sessionUserId,
      });
    } catch (giftErr) {
      console.error(`[pos] gift card issue failed: order=${order.id}:`, giftErr);
      giftCardIssueError =
        'Order LUNAS tapi kartu gagal terbit — catat nomor order dan hubungi admin';
    }
    // WA hanya tambahan; kode tetap tercetak di struk (keputusan owner).
    if (giftCardsIssued.length > 0 && buyerPhone) {
      void sendGiftCardSoldWa({ buyerName, buyerPhone, cards: giftCardsIssued }).catch((waErr) =>
        console.error(`[pos] gift card WA failed: order=${order.id}:`, waErr)
      );
    }
  }

  // Jurnal dulu, baru capture voucher — supaya gagal balance tidak
  // meninggalkan promo terpakai tanpa jejak jurnal yang jelas.
  let accountingNote: string | null = null;
  if (order.payment_status === 'paid') {
    const { postPosSaleAccountingJournals } = await import('@/lib/pos/accounting-posting');
    try {
      const accounting = await postPosSaleAccountingJournals({
        db,
        orderId: order.id,
        userId: sessionUserId,
        paymentMethod: payment_method,
      });
      accountingNote = accounting.note;
    } catch (err) {
      if (!(err instanceof AccountingPostError)) throw err;
      // Order sudah lunas; jangan gagalkan checkout. Catat untuk admin.
      console.error(`[pos] accounting post failed: order=${order.id}:`, err);
      accountingNote = err.message;
    }
  }

  // EPIC-032 C1 — order lunas → pemakaian kode FINAL (held → captured).
  // Void order melepasnya kembali (route void).
  const { promoOrderId, offerOrderId } = placed;
  if (promoOrderId) {
    await withTransaction((client) =>
      capturePromoRedemption(client, 'pos_order', promoOrderId)
    ).catch((err) => console.error('[pos] capture promo error:', err));
  }
  if (offerOrderId) {
    await withTransaction((client) => captureOfferUsage(client, offerOrderId)).catch((err) =>
      console.error('[pos] capture offer usage error:', err)
    );
  }

  const { data: completeOrder } = await db
    .from('pos_orders')
    .select(`*, customer:pos_customers(name, phone), items:pos_order_items(*)`)
    .eq('id', order.id)
    .single();

  return {
    status: 201,
    body: {
      success: true,
      data: completeOrder || order,
      crm_xp: crmXp,
      // EPIC-041: snapshot utk struk — saldo ARK setelah potong (Rupiah,
      // konversi ARK di klien via ark_rate) & total XP member setelah award.
      ark_balance_after: settled.arkBalanceAfter,
      xp_total_after: xpTotalAfter,
      message: accountingNote || undefined,
      ...(sellsGiftCard ? { gift_cards: giftCardsIssued, gift_card_error: giftCardIssueError } : {}),
    },
  };
}
