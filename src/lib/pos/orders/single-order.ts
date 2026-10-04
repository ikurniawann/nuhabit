import { randomUUID } from 'crypto';
import { getCrmDefaultVenue } from '@/lib/crm/server';
import { withTransaction } from '@/lib/db';
import { validateKolComp } from '@/lib/pos/comp-orders-server';
import { normalizeGuestCount } from '@/lib/pos/guest-count';
import { buildDiscountReason, computeOrderDiscountStack } from '@/lib/pos/manual-discount';
import { claimMerchandiseStock, restoreMerchandiseStock } from '@/lib/pos/merchandise-stock';
import { isFocPaymentMethod } from '@/lib/pos/payment-methods';
import { assertQrisSaleMaySettle } from '@/lib/pos/qris-settle-guard';
import { allocateQueueNumber } from '@/lib/pos/queue-number';
import { approveWithSupervisorPin, supervisorPinLockedMessage } from '@/lib/pos/supervisor-pin-server';
import { sanitizeXenditRef } from '@/lib/pos/xendit-ids';
import { evaluateActiveOffersForPosCart } from '@/lib/promo/offer-pos';
import { OfferCapReachedError, recordOfferUsage } from '@/lib/promo/offer-rules-server';
import { PromoRejectedError, holdPromoRedemption, type PromoHold } from '@/lib/promo/promo-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { notifyCompTransaction } from '@/lib/wa/comp-notification';
import {
  buildLineInputs,
  buildOrderInsertRows,
  computeItemsSubtotal,
  itemQuantity,
  itemUnitPrice,
  parseDiscountType,
  parseNullableNumber,
  resolveTrustedTotal,
} from './order-pricing';
import {
  orderError,
  type MerchClaimsRef,
  type OrderContext,
  type OrderResponse,
} from './order-types';
import {
  guardBalancePayment,
  guardCompRequest,
  guardFocRequest,
  guardSettlement,
} from './payment-guards';
import { releasePromoHold, settleAndCompleteOrder } from './settle-order';

/**
 * Order tunggal (satu metode bayar). Tidak memakai RPC DB lama karena
 * sebagian database masih memasukkan p_order_type TEXT ke enum
 * pos_order_type tanpa cast.
 */
export async function createSingleOrder(
  ctx: OrderContext,
  merch: MerchClaimsRef
): Promise<OrderResponse> {
  const { db, req, sessionUserId } = ctx;
  const { items, customer_id, payment_method } = req;

  const venue = await getCrmDefaultVenue(db);
  const branchId = req.branch_id || venue.branchId;
  const { data: orderNumData, error: orderNumErr } = await db.rpc('generate_order_number');
  if (orderNumErr) return orderError(500, orderNumErr.message);

  const orderNumber = typeof orderNumData === 'string' ? orderNumData : String(orderNumData);
  const queueNumber = await allocateQueueNumber(db, venue.companyId, branchId);
  const serverSubtotal = computeItemsSubtotal(items);
  const serverTax = Number(req.tax_amount) || 0;
  const serverServiceCharge = Number(req.service_charge_amount) || 0;
  const serverOtherCharges = Number(req.other_charges_amount) || 0;
  const lineInputs = buildLineInputs(items);
  const membershipPct = Number(req.membership_discount_pct) || 0;
  const manualType = parseDiscountType(req.manual_discount_type);
  const manualValue = parseNullableNumber(req.manual_discount_value);

  // Kode kasir = kode pembuka penawaran ATAU kode campaign promo.
  const enteredCode = String(req.promo_code || '').trim();
  const offerEval = await evaluateActiveOffersForPosCart({
    companyId: venue.companyId,
    branchId,
    code: enteredCode || null,
    customerId: customer_id || null,
    items: items.map((item) => ({
      productId: String(item.product_id || ''),
      quantity: itemQuantity(item),
      unitPrice: itemUnitPrice(item),
    })),
  });

  // EPIC-032 C1 — kode promo kasir. Hold DI AWAL dgn id order yang
  // di-generate sendiri (insert pakai id eksplisit) supaya kuota terkunci
  // sebelum uang diterima; diskon = turunan SERVER (line + offer + membership
  // + promo + manual), klien hanya diverifikasi. Gagal lolos → 422 sebelum
  // ada baris order.
  const promoCode = offerEval.unlocked_rule_id ? '' : enteredCode;
  let promoHold: PromoHold | null = null;
  let promoOrderId: string | null = null;
  const stackInput = {
    items: lineInputs,
    offer_discount: offerEval.offer_discount,
    membership_pct: membershipPct,
    manual_discount_type: manualType,
    manual_discount_value: manualValue,
  };

  if (promoCode) {
    const companyId = venue.companyId;
    if (!companyId || !branchId) {
      return orderError(400, 'Venue belum dikonfigurasi — kode promo tidak bisa dipakai');
    }
    const provisionalStack = computeOrderDiscountStack({ ...stackInput, promo_discount: 0 });
    const holdOrderId = randomUUID();
    promoOrderId = holdOrderId;
    try {
      promoHold = await withTransaction((client) =>
        holdPromoRedemption(client, {
          scope: { companyId, branchId },
          code: promoCode,
          channel: 'pos',
          contextType: 'pos_order',
          contextId: holdOrderId,
          subtotal: provisionalStack.items_subtotal,
          phone: null,
          customerId: customer_id || null,
          lines: items.map((item, index) => ({
            productId: String(item.product_id || ''),
            amount: provisionalStack.line_results[index]?.total_amount ?? 0,
          })),
        })
      );
    } catch (promoErr) {
      if (promoErr instanceof PromoRejectedError) return orderError(422, promoErr.message);
      throw promoErr;
    }
  }

  const stack = computeOrderDiscountStack({
    ...stackInput,
    promo_discount: promoHold?.discount ?? 0,
  });
  const serverDiscount = stack.discount_amount;

  if (Math.abs((Number(req.discount_amount) || 0) - serverDiscount) > 1) {
    await releasePromoHold(promoOrderId);
    return orderError(400, 'Total diskon tidak cocok — muat ulang dan coba lagi');
  }

  // Kuota penawaran dikunci sebelum order dibuat (held; lunas → captured).
  const hasOffers = offerEval.applied.length > 0;
  const presetOrderId = promoOrderId ?? (hasOffers ? randomUUID() : null);
  if (presetOrderId && hasOffers) {
    try {
      await withTransaction((client) =>
        recordOfferUsage(client, {
          companyId: venue.companyId,
          branchId,
          orderId: presetOrderId,
          customerId: customer_id || null,
          applied: offerEval.applied,
          status: 'held',
          enforce: true,
        })
      );
    } catch (offerErr) {
      if (!(offerErr instanceof OfferCapReachedError)) throw offerErr;
      await releasePromoHold(promoOrderId);
      return orderError(422, offerErr.message);
    }
  }

  const discountReason = buildDiscountReason({
    has_item_discounts: stack.line_discount_total > 0,
    offer_labels: offerEval.applied.map((a) => a.name),
    membership_pct: membershipPct,
    promo_code: promoCode || null,
    manual_type: manualType,
    manual_value: manualValue,
  });

  const serverTotal = resolveTrustedTotal({
    paymentMethod: payment_method,
    hasPromoHold: Boolean(promoHold),
    clientTotal: req.total_amount,
    subtotal: serverSubtotal,
    discount: serverDiscount,
    tax: serverTax,
    serviceCharge: serverServiceCharge,
    otherCharges: serverOtherCharges,
  });
  const paidAmount = Number(req.amount_paid) || 0;
  const arkUsed = Number(req.ark_coins_used) || 0;
  const nfcTabUid = String(req.nfc_tab_uid || '').trim();
  const giftCardCode = String(req.gift_card_code || '').trim().toUpperCase();
  const isNfcTab = payment_method === 'nfc_tab';
  const payWithGiftCard = payment_method === 'gift_card';

  if (isNfcTab && !checkRateLimit(`pos-nfc-tab:${sessionUserId}`, 30).allowed) {
    return orderError(429, 'Terlalu banyak percobaan NFC Tab — tunggu sebentar');
  }
  if (payWithGiftCard && !checkRateLimit(`pos-gift-card:${sessionUserId}`, 30).allowed) {
    return orderError(429, 'Terlalu banyak percobaan gift card — tunggu sebentar');
  }
  const balanceGuard = guardBalancePayment({
    paymentMethod: payment_method,
    nfcTabUid,
    giftCardCode,
    arkUsed,
    venue,
    sellsGiftCard: ctx.giftCardNominals.length > 0,
  });
  if (!balanceGuard.ok) return orderError(balanceGuard.status, balanceGuard.error);

  if (payment_method === 'qris') {
    const qrisId = sanitizeXenditRef(req.xendit_qr_id);
    const qrisExternalId = sanitizeXenditRef(req.xendit_external_id);
    let qrisAlreadyUsed = false;
    if (qrisId || qrisExternalId) {
      const usedQuery = db.from('pos_orders').select('id').eq('payment_status', 'paid').limit(1);
      const { data: usedRow } = await (qrisId
        ? usedQuery.eq('xendit_qr_id', qrisId)
        : usedQuery.eq('xendit_external_id', qrisExternalId)
      ).maybeSingle();
      qrisAlreadyUsed = Boolean(usedRow);
    }
    const qrisGate = assertQrisSaleMaySettle({
      paymentMethod: payment_method,
      xenditQrId: qrisId,
      xenditExternalId: qrisExternalId,
      alreadyUsedByPaidOrder: qrisAlreadyUsed,
    });
    if (!qrisGate.ok) return orderError(400, qrisGate.message);
  }

  // Metode FOC (Free of Charge), keputusan owner 2026-08-24: wajib disetujui
  // PIN supervisor dan ber-customer; penyetuju dicatat.
  let focApprover: { id: string; name: string } | null = null;
  if (isFocPaymentMethod(req.payment_method_code, req.payment_method_name)) {
    const pin = String(req.supervisor_pin || '').trim();
    const focGuard = guardFocRequest({ customerId: customer_id, supervisorPin: pin });
    if (!focGuard.ok) return orderError(focGuard.status, focGuard.error);
    const approval = await approveWithSupervisorPin({ callerId: sessionUserId, pin });
    if (!approval.ok) {
      return approval.reason === 'locked'
        ? orderError(429, supervisorPinLockedMessage(approval.retryMinutes))
        : orderError(403, 'PIN supervisor tidak valid');
    }
    focApprover = approval.supervisor;
  }

  const settlementGuard = guardSettlement({
    paymentMethod: payment_method,
    focApproved: Boolean(focApprover),
    paidAmount,
    arkUsed,
    total: serverTotal,
    customerId: customer_id,
  });
  if (!settlementGuard.ok) return orderError(settlementGuard.status, settlementGuard.error);

  // EPIC-043: komplimen KOL gratis OTOMATIS utk customer bertanda is_kol,
  // divalidasi server (bukan kepercayaan ke kasir): customer wajib KOL dan
  // kuota bulanan (bila diset) cukup.
  const compGuard = guardCompRequest({
    compType: req.comp_type,
    customerId: customer_id,
    total: serverTotal,
  });
  if (!compGuard.ok) return orderError(compGuard.status, compGuard.error);
  if (compGuard.compType && customer_id) {
    const kol = await validateKolComp({ customerId: customer_id, grossIdr: serverSubtotal });
    if (!kol.ok) return orderError(403, kol.reason);
  }

  const payWithArk = arkUsed > 0 && Boolean(customer_id);
  // Order ARK/NFC Tab/Gift Card dibuat pending dulu; paid setelah debit/charge sukses
  const deferPaid = payWithArk || isNfcTab || payWithGiftCard;

  // EPIC-039 Fase A — klaim stok merchandise SEBELUM order dibuat (decrement
  // atomik ber-guard di SQL; dua kasir memperebutkan stok terakhir → satu
  // gagal). Produk non-merchandise dilewati fungsi SQL.
  const merchClaimResult = await claimMerchandiseStock(db, items);
  if (!merchClaimResult.ok) {
    await releasePromoHold(promoOrderId);
    return orderError(merchClaimResult.status, merchClaimResult.reason);
  }
  merch.claims = merchClaimResult.claims;

  const { row, legacy } = buildOrderInsertRows({
    presetOrderId,
    promoOrderId,
    orderNumber,
    queueNumber,
    orderType: req.order_type,
    deferPaid,
    companyId: venue.companyId,
    branchId,
    warehouseId: ctx.sellWarehouseId,
    customerId: customer_id || null,
    cashierId: ctx.cashierId,
    serverId: req.server_id || null,
    tableId: req.table_id || null,
    guestCount: normalizeGuestCount(req.guest_count),
    shiftId: req.shift_id || null,
    subtotal: serverSubtotal,
    discount: serverDiscount,
    discountReason,
    manualDiscountType: manualType,
    manualDiscountValue: manualValue,
    tax: serverTax,
    serviceCharge: serverServiceCharge,
    otherCharges: serverOtherCharges,
    chargesBreakdown: Array.isArray(req.charges_breakdown) ? req.charges_breakdown : [],
    total: serverTotal,
    paidAmount,
    arkUsed,
    paymentMethod: payment_method,
    notes: req.notes || null,
    specialRequests: req.special_requests || null,
    orderedAt: new Date().toISOString(),
    soldFrom: ctx.soldFrom,
    xenditQrId: req.xendit_qr_id,
    xenditExternalId: req.xendit_external_id,
    paymentMethodCode: req.payment_method_code,
    paymentMethodName: req.payment_method_name,
    compType: compGuard.compType,
    focApprover,
  });

  const inserted = await db.from('pos_orders').insert(row).select().single();
  // DB lama tanpa kolom baru → coba lagi dgn payload legacy.
  const { data: orderData, error: orderInsertErr } =
    inserted.error?.code === '42703' || inserted.error?.code === 'PGRST204'
      ? await db.from('pos_orders').insert(legacy).select().single()
      : inserted;

  if (orderInsertErr || !orderData) {
    console.error('Order insert error:', orderInsertErr);
    await restoreMerchandiseStock(db, merch.claims);
    merch.claims = [];
    await releasePromoHold(promoOrderId);
    return orderError(500, orderInsertErr?.message || 'Failed to create order');
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

  return settleAndCompleteOrder({
    ctx,
    merch,
    order: orderData,
    orderNumber,
    queueNumber,
    scope: { companyId: venue.companyId as string, branchId: branchId as string },
    total: serverTotal,
    arkUsed,
    payWithArk,
    deferPaid,
    nfcTabUid,
    giftCardCode,
    promoOrderId,
    offerOrderId: hasOffers ? presetOrderId : null,
    lineResults: stack.line_results,
    isFoc: Boolean(focApprover),
  });
}
