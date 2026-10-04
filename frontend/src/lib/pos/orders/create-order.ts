import { getApiUserScope } from '@/lib/api/scope';
import { getStallAccess } from '@/lib/auth/stall-access';
import { ARK_COIN_DISABLED_MESSAGE } from '@/lib/crm/loyalty-features';
import { getLoyaltyFeatures } from '@/lib/crm/loyalty-features-server';
import { checkProductPrivileges } from '@/lib/crm/product-privilege';
import { queryOne } from '@/lib/db';
import { prepareGiftCardSale } from '@/lib/giftcard/giftcard-server';
import { createPgClient } from '@/lib/pg/create-client';
import { AccountingPostError } from '@/lib/pos/accounting-posting';
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
import { restoreMerchandiseStock } from '@/lib/pos/merchandise-stock';
import {
  assertOrderItemsMatchSellStall,
  loadCentralCashierGate,
  loadPosProductWarehouseIds,
  resolvePosSellStallForUser,
} from '@/lib/pos/pos-sell-stall-server';
import {
  orderError,
  withOrderDefaults,
  type MerchClaimsRef,
  type OrderResponse,
  type PosOrderBody,
} from './order-types';
import { createSingleOrder } from './single-order';
import { createSplitOrder } from './split-order';

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

/** POST /api/pos/orders — checkout campuran, split bill, atau order tunggal. */
export async function createPosOrder(
  body: PosOrderBody,
  sessionUserId: string
): Promise<OrderResponse> {
  const merch: MerchClaimsRef = { claims: [] };
  try {
    const req = withOrderDefaults(body);
    const { items, customer_id } = req;

    if (!Array.isArray(items) || items.length === 0) {
      return orderError(400, 'Items and total amount are required');
    }
    // Pengaman ARK Coin: klien lama/tab terbuka tetap bisa mengirim pembayaran
    // ARK saat fiturnya dimatikan.
    if (req.payment_method === 'ark_coin' || Number(req.ark_coins_used) > 0) {
      const { arkCoin } = await getLoyaltyFeatures();
      if (!arkCoin) {
        return {
          status: 409,
          body: { success: false, error: ARK_COIN_DISABLED_MESSAGE, code: 'ARK_COIN_DISABLED' },
        };
      }
    }

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
      hasSplits: Array.isArray(req.splits) && req.splits.length > 0,
      promoCode: req.promo_code,
    });
    if (!mixedGuard.ok) return orderError(400, mixedGuard.message);

    if (mixedGuard.createCheckout) {
      const privilege = await checkProductPrivileges(createPgClient(), productIds, customer_id);
      if (!privilege.allowed) return orderError(403, privilege.message);
      const result = await createMixedCheckout({
        items,
        warehouseByProduct,
        orderType: req.order_type,
        customerId: customer_id,
        cashierId: await resolveCashierId(sessionUserId, req.cashier_id),
        serverId: req.server_id,
        tableId: req.table_id,
        guestCount: req.guest_count,
        discountAmount: req.discount_amount,
        discountReason: req.discount_reason,
        promoCode: req.promo_code,
        taxAmount: req.tax_amount,
        serviceChargeAmount: req.service_charge_amount,
        otherChargesAmount: req.other_charges_amount,
        chargesBreakdown: req.charges_breakdown,
        totalAmount: req.total_amount,
        paymentMethod: req.payment_method,
        amountPaid: req.amount_paid,
        arkCoinsUsed: req.ark_coins_used,
        notes: req.notes,
        specialRequests: req.special_requests,
        companyId: scope?.companyId,
        branchId: req.branch_id || scope?.branchId,
        shiftId: req.shift_id,
        sessionUserId,
        paymentMethodCode: req.payment_method_code,
        paymentMethodName: req.payment_method_name,
      });
      return {
        status: 201,
        body: {
          success: true,
          data: {
            checkout_id: result.checkoutId,
            checkout_number: result.checkoutNumber,
            queue_number: result.queueNumber,
            order_ids: result.orderIds,
          },
        },
      };
    }

    const soldFrom = resolveOrderSoldFrom({
      isCentralCashier: gate.hasCentralMenu && gate.canCentralCheckout,
    });
    const singleStallFromAll = resolveSingleStallSellFromAllMode({ itemWarehouses, canSellMixed });

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
      if (!assigned.ok) return orderError(400, assigned.message);
      sellWarehouseId = singleStallFromAll;
    } else {
      const sellStall = await resolvePosSellStallForUser(sessionUserId);
      if (!sellStall.ok) return orderError(400, sellStall.message);
      sellWarehouseId = sellStall.warehouseId;
    }

    const itemStallCheck = await assertOrderItemsMatchSellStall(productIds, sellWarehouseId);
    if (!itemStallCheck.ok) return orderError(400, itemStallCheck.message);

    const cashierId = await resolveCashierId(sessionUserId, req.cashier_id);
    const splits = Array.isArray(req.splits) ? req.splits : [];
    const db = createPgClient();

    // Produk privilege (min_xp): tolak sebelum order dibuat — EPIC-011 Fase C
    const privilege = await checkProductPrivileges(db, productIds, customer_id);
    if (!privilege.allowed) return orderError(403, privilege.message);

    // EPIC-034 Fase B — nominal gift card DIKETIK kasir, jadi server memuat
    // ulang product_kind dari katalog dan memvalidasi tiap nominal ke
    // konfigurasi. Kartu baru terbit SETELAH order lunas.
    const giftCardSale = await prepareGiftCardSale(items);
    if (!giftCardSale.ok) return orderError(400, giftCardSale.reason);

    const ctx = {
      db,
      req,
      sessionUserId,
      cashierId,
      sellWarehouseId,
      soldFrom,
      giftCardNominals: giftCardSale.nominals,
    };
    if (splits.length > 0) return await createSplitOrder(ctx, splits);
    return await createSingleOrder(ctx, merch);
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) return orderError(error.status, error.message);
    if (error instanceof AccountingPostError) return orderError(500, error.message);
    console.error('Error creating order:', error);
    if (merch.claims.length > 0) {
      // Error dilempar setelah stok diklaim (mis. markPaidErr) → kembalikan.
      await restoreMerchandiseStock(createPgClient(), merch.claims).catch((restoreErr) =>
        console.error('[pos] merch stock restore in catch failed:', restoreErr)
      );
      merch.claims = [];
    }
    return orderError(500, error instanceof Error ? error.message : 'Unknown error');
  }
}
