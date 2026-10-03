import { NextRequest } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { withTransaction } from '@/lib/db';
import { restoreMerchandiseStockForOrder } from '@/lib/pos/merchandise-stock';
import { findSupervisorByPin } from '@/lib/pos/supervisor-pin';
import {
  canVoidOrderStatus,
  isPaidPosOrder,
  resolveArkRefundAmount,
  resolveCustomerStatsReversal,
} from '@/lib/pos/void-order';
import { releasePromoRedemption } from '@/lib/promo/promo-server';
import { releaseOfferUsage } from '@/lib/promo/offer-rules-server';
import {
  IssuedGiftCardAlreadyUsedError,
  refundGiftCardForPosOrder,
  voidIssuedGiftCardsForPosOrder,
} from '@/lib/giftcard/giftcard-server';
import { voidFnbOrderFromTab } from '@/lib/ticketing/tab-server';
import { reverseCrmXpForVoidedOrders } from '@/lib/crm/loyalty-engine';
import { buildVoidBesarMessage, voidDedupKey } from '@/lib/wa/notifications-messages';
import { fireOwnerNotification, getWaNotifConfig } from '@/lib/wa/notifications-sender';

type VoidOrderRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  order_number: string | null;
  total_amount: number | string | null;
  customer_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  checkout_id: string | null;
  ark_coins_used: number | string | null;
};

async function loadVoidFamily(
  db: ReturnType<typeof createPgClient>,
  order: VoidOrderRow
): Promise<VoidOrderRow[]> {
  if (!order.checkout_id) return [order];
  const { data, error } = await db
    .from('pos_orders')
    .select(
      'id, status, payment_status, payment_method, order_number, total_amount, customer_id, company_id, branch_id, checkout_id, ark_coins_used'
    )
    .eq('checkout_id', order.checkout_id);
  if (error) throw error;
  const rows = (data ?? []) as VoidOrderRow[];
  return rows.length > 0 ? rows : [order];
}

export async function POST(
  request: NextRequest,
  // Next 16: params adalah Promise — akses sinkron membuat id undefined
  // dan SEMUA void gagal "Order not found" (bug sejak upgrade).
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { reason, supervisor_pin } = body;
    const { id: orderId } = await params;

    if (!reason || !supervisor_pin) {
      return Response.json({ success: false, error: 'Reason and supervisor PIN required' }, { status: 400 });
    }

    const db = createPgClient();

    // 1. Validate supervisor PIN — pos_pin kini hash bcrypt (UI kelola PIN),
    //    nilai plaintext lama tetap diterima sampai di-reset dari UI.
    const { data: supervisorRows } = await db
      .from('users')
      .select('id, full_name, role, pos_pin')
      .eq('role', 'pos_supervisor');
    const supervisor = await findSupervisorByPin(
      supervisorRows ?? [],
      String(supervisor_pin)
    );

    if (!supervisor) {
      return Response.json({ success: false, error: 'PIN supervisor tidak valid' }, { status: 403 });
    }

    // 2. Fetch order
    const { data: order, error: orderErr } = await db
      .from('pos_orders')
      .select(
        'id, status, payment_status, payment_method, order_number, total_amount, customer_id, company_id, branch_id, checkout_id, ark_coins_used'
      )
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return Response.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const source = order as VoidOrderRow;
    if (!canVoidOrderStatus(source.status)) {
      if (source.status === 'voided') {
        return Response.json({ success: false, error: 'Order already voided' }, { status: 400 });
      }
      if (source.status === 'merged') {
        return Response.json({ success: false, error: 'Cannot void merged order' }, { status: 400 });
      }
      return Response.json({ success: false, error: 'Order tidak bisa di-void' }, { status: 400 });
    }

    const family = await loadVoidFamily(db, source);
    const voidable = family.filter((row) => canVoidOrderStatus(row.status));
    if (voidable.length === 0) {
      return Response.json({ success: false, error: 'Order already voided' }, { status: 400 });
    }

    const paidRows = voidable.filter((row) => isPaidPosOrder(row));
    const now = new Date().toISOString();
    const voidReason = String(reason).trim();

    // 3. Balik tender dulu (idempoten) — baru stempel void, supaya retry
    //    tidak dobel-refund bila update status gagal.
    if (paidRows.length > 0) {
      for (const row of voidable) {
        try {
          await voidIssuedGiftCardsForPosOrder({
            orderId: row.id,
            note: ` — void ${row.order_number || row.id}`,
          });
        } catch (err) {
          if (err instanceof IssuedGiftCardAlreadyUsedError) {
            return Response.json({ success: false, error: err.message }, { status: 409 });
          }
          throw err;
        }
      }

      const { data: walletRows } = await db
        .from('pos_wallet_transactions')
        .select('order_id, type, amount')
        .in('order_id', voidable.map((row) => row.id));
      const payments = (walletRows ?? []).filter((row) => row.type === 'payment');
      const alreadyRefunded = (walletRows ?? []).some((row) => row.type === 'refund');
      const walletPaymentAmount = payments.reduce(
        (max, row) => Math.max(max, Number(row.amount) || 0),
        0
      );
      const arkRefund = alreadyRefunded
        ? 0
        : resolveArkRefundAmount({
            paymentMethod: source.payment_method || paidRows[0]?.payment_method,
            orders: voidable,
            walletPaymentAmount,
          });
      const arkCustomerId =
        source.customer_id ||
        voidable.find((row) => row.customer_id)?.customer_id ||
        null;
      if (arkRefund > 0 && arkCustomerId) {
        const { error: coinError } = await db.rpc('update_ark_coin_balance', {
          p_customer_id: arkCustomerId,
          p_amount: arkRefund,
          p_type: 'refund',
          p_order_id: source.id,
          p_notes: `Void ${source.order_number || source.id}`,
        });
        if (coinError) {
          return Response.json(
            { success: false, error: 'Gagal mengembalikan ARK Coin' },
            { status: 400 }
          );
        }
      }

      for (const row of voidable) {
        if (!row.company_id || !row.branch_id) continue;
        await refundGiftCardForPosOrder({
          scope: { companyId: row.company_id, branchId: row.branch_id },
          orderId: row.id,
          createdBy: supervisor.id,
          note: `Pengembalian saldo — void ${row.order_number || row.id}`,
        }).catch((refundErr) =>
          console.error(`[pos] gift_card refund failed: order=${row.id}:`, refundErr)
        );
        await voidFnbOrderFromTab({
          orderId: row.id,
          reason: voidReason,
          createdBy: supervisor.id,
        }).catch((tabErr) =>
          console.error(`[pos] nfc_tab void failed: order=${row.id}:`, tabErr)
        );
      }
    }

    // 4. Stempel void + refunded
    const voidIds = voidable.map((row) => row.id);
    const { error: updErr } = await db
      .from('pos_orders')
      .update({
        status: 'voided',
        payment_status: paidRows.length > 0 ? 'refunded' : source.payment_status,
        voided_at: now,
        voided_by: supervisor.id,
        void_reason: voidReason,
        updated_at: now,
      })
      .in('id', voidIds);
    if (updErr) throw updErr;

    if (source.checkout_id && paidRows.length > 0) {
      const { error: checkoutErr } = await db
        .from('pos_checkouts')
        .update({
          payment_status: 'refunded',
          updated_at: now,
        })
        .eq('id', source.checkout_id);
      if (checkoutErr) {
        console.error('[pos] checkout void stamp failed:', checkoutErr);
      }
    }

    for (const row of voidable) {
      await restoreMerchandiseStockForOrder(db, row.id);
      await withTransaction(async (client) => {
        await releasePromoRedemption(client, 'pos_order', row.id);
        await releaseOfferUsage(client, row.id);
      }).catch((err) => console.error('[pos] release promo error:', err));
      await db
        .from('pos_order_splits')
        .update({ status: 'cancelled', updated_at: now })
        .eq('order_id', row.id)
        .eq('status', 'pending');
    }

    // XP ikut dibatalkan saat void (keputusan owner 2026-08-23) — idempoten
    // di dalam helper. Kegagalan di sini tidak membatalkan void yang sudah
    // jadi (refund ARK & stempel sudah selesai), cukup tercatat di log.
    if (paidRows.length > 0) {
      await reverseCrmXpForVoidedOrders(db, {
        orderIds: voidIds,
        voidReason,
      }).catch((xpErr) => console.error('[pos] void XP reversal failed:', xpErr));
    }

    const stats = resolveCustomerStatsReversal({
      customerId: source.customer_id || voidable.find((row) => row.customer_id)?.customer_id,
      paidOrders: paidRows,
    });
    if (stats) {
      const { data: customer } = await db
        .from('pos_customers')
        .select('total_spent, visit_count')
        .eq('id', stats.customerId)
        .maybeSingle();
      if (customer) {
        const spent = Math.max(0, (Number(customer.total_spent) || 0) - stats.amount);
        const visits = Math.max(0, (Number(customer.visit_count) || 0) - stats.visitDelta);
        await db
          .from('pos_customers')
          .update({
            total_spent: spent,
            visit_count: visits,
            updated_at: now,
          })
          .eq('id', stats.customerId);
      }
    }

    // 5. EPIC-020: void bernilai besar → WA owner (event, bukan polling).
    try {
      const total = voidable.reduce((sum, row) => sum + (Number(row.total_amount) || 0), 0);
      const config = await getWaNotifConfig();
      if (total >= config.voidThresholdRp) {
        fireOwnerNotification({
          type: 'voidBesar',
          dedupKey: voidDedupKey(orderId),
          message: buildVoidBesarMessage({
            orderNumber: String(source.order_number ?? orderId.slice(0, 8)),
            total,
            reason: voidReason,
            supervisorName: supervisor.full_name ?? 'supervisor',
          }),
          config,
        });
      }
    } catch (notifError) {
      console.error('[wa-notif] gagal menyiapkan notif void:', notifError);
    }

    return Response.json({
      success: true,
      data: {
        order_id: orderId,
        voided_order_ids: voidIds,
        message: 'Order voided successfully',
      },
    });
  } catch (error: unknown) {
    console.error('Void error:', error);
    const message = error instanceof Error ? error.message : 'Void gagal diproses';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
