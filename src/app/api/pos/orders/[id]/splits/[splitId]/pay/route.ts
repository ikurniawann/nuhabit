import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { awardCrmXpForSplitPayment, syncPosCustomerOrderStats } from '@/lib/crm/loyalty-engine';
import { AccountingPostError } from '@/lib/pos/accounting-posting';
import { rejectIfArkCoinDisabled } from '@/lib/crm/loyalty-features-server';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

// POST /api/pos/orders/{id}/splits/{splitId}/pay
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; splitId: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: orderId, splitId } = await params;
    const body = await request.json();
    const {
      payment_method,
      amount_paid,
      ark_coins_used = 0,
      reference_number,
    } = body;

    if (!payment_method || amount_paid == null) {
      return NextResponse.json({ success: false, error: 'payment_method and amount_paid required' }, { status: 400 });
    }
    const arkBlocked = await rejectIfArkCoinDisabled(payment_method === 'ark_coin' || Number(ark_coins_used) > 0);
    if (arkBlocked) return arkBlocked;

    const db = createPgClient();
    // Kasir = user sesi POS (dulu ID sistem tetap 0000…0001, jejak audit hilang).
    const cashierId = sessionUserId;

    const { data: split, error: splitError } = await db
      .from('pos_order_splits')
      .select('*')
      .eq('id', splitId)
      .eq('order_id', orderId)
      .single();

    if (splitError || !split) {
      return NextResponse.json({ success: false, error: 'Split not found' }, { status: 404 });
    }

    if (split.status === 'cancelled') {
      return NextResponse.json({ success: false, error: 'Split already cancelled' }, { status: 400 });
    }

    if (split.status === 'paid') {
      return NextResponse.json({ success: false, error: 'Split already paid' }, { status: 400 });
    }

    const amountPaid = Number(amount_paid);
    const splitTotal = Number(split.total_amount || 0);
    if (amountPaid < splitTotal) {
      return NextResponse.json({ success: false, error: `Nominal bayar kurang dari total split ${splitTotal}` }, { status: 400 });
    }

    const changeAmount = amountPaid - splitTotal;
    const arkUsed = Number(ark_coins_used || 0);

    // EPIC-034 Fase C — gift card belum didukung utk split bill (MVP):
    // keputusan owner "1 transaksi 1 metode, full-cover" mengacu ke SATU
    // transaksi utuh, sementara split memecah tagihan ke beberapa pembayar.
    // Ditolak rapi supaya tidak ada jalur debit setengah-setengah.
    if (payment_method === 'gift_card') {
      return NextResponse.json(
        { success: false, error: 'Gift card belum didukung untuk split bill' },
        { status: 400 }
      );
    }

    // 1 pembayaran = 1 metode (EPIC-011): ARK Coin tidak dicampur metode lain,
    // dan harus menutup seluruh total split.
    if (arkUsed > 0 && payment_method !== 'ark_coin') {
      return NextResponse.json(
        { success: false, error: 'ARK Coin tidak bisa dicampur metode lain — 1 pembayaran 1 metode' },
        { status: 400 }
      );
    }
    if (payment_method === 'ark_coin' && arkUsed < splitTotal) {
      return NextResponse.json(
        { success: false, error: 'Pembayaran ARK Coin harus menutup seluruh total split' },
        { status: 400 }
      );
    }

    if (arkUsed > 0) {
      if (!split.customer_id) {
        return NextResponse.json({ success: false, error: 'ARK Coin butuh customer member' }, { status: 400 });
      }

      // Atomic deduct via RPC: locks the customer row (FOR UPDATE), rejects an
      // insufficient balance inside the same transaction, and logs the wallet
      // transaction — eliminates the read-then-write race / double-spend.
      const { error: arkError } = await db.rpc('update_ark_coin_balance', {
        p_customer_id: split.customer_id,
        p_amount: -arkUsed,
        p_type: 'payment',
        p_order_id: orderId,
        p_notes: `Split payment ${splitId}`,
      });

      if (arkError) {
        const insufficient = arkError.message?.includes('Insufficient');
        return NextResponse.json(
          { success: false, error: insufficient ? 'Saldo ARK Coin tidak cukup' : 'Gagal memproses ARK Coin' },
          { status: 400 }
        );
      }
    }

    const { data: paymentRow, error: paymentError } = await db
      .from('pos_split_payments')
      .insert({
        split_id: splitId,
        order_id: orderId,
        amount: amountPaid,
        change_amount: changeAmount,
        payment_method,
        reference_number: reference_number || null,
        cashier_id: cashierId,
      })
      .select('id')
      .single();

    if (paymentError) {
      return NextResponse.json({ success: false, error: paymentError.message }, { status: 500 });
    }

    const { error: splitUpdateError } = await db
      .from('pos_order_splits')
      .update({
        status: 'paid',
        payment_method,
        amount_paid: amountPaid,
        change_amount: changeAmount,
        ark_coins_used: arkUsed,
        paid_at: new Date().toISOString(),
      })
      .eq('id', splitId);

    if (splitUpdateError) {
      return NextResponse.json({ success: false, error: splitUpdateError.message }, { status: 500 });
    }

    const { count: totalSplits } = await db
      .from('pos_order_splits')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);

    const { count: paidSplits } = await db
      .from('pos_order_splits')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('status', 'paid');

    const allPaid = (totalSplits || 0) > 0 && totalSplits === paidSplits;
    const paymentStatus = allPaid ? 'paid' : 'partial';

    const { error: orderUpdateError } = await db
      .from('pos_orders')
      .update({
        payment_status: paymentStatus,
      })
      .eq('id', orderId);

    if (orderUpdateError) {
      return NextResponse.json({ success: false, error: orderUpdateError.message }, { status: 500 });
    }

    await db.from('pos_order_status_history').insert({
      order_id: orderId,
      from_status: null,
      to_status: null,
      reason: `Split ${split.label || split.split_index} paid via ${payment_method}`,
      changed_at: new Date().toISOString(),
    });

    // Statistik kunjungan/belanja untuk semua metode pembayaran
    if (split.customer_id) {
      await syncPosCustomerOrderStats(db, split.customer_id, splitTotal);
    }

    let accountingNote: string | null = null;
    try {
      const { data: orderRow } = await db
        .from('pos_orders')
        .select('total_amount, service_charge_amount, other_charges_amount')
        .eq('id', orderId)
        .maybeSingle();
      const { data: costItems } = await db
        .from('pos_order_items')
        .select('cost_total')
        .eq('order_id', orderId);
      const orderCogs = ((costItems || []) as Array<{ cost_total?: unknown }>).reduce(
        (sum, item) => sum + Math.max(0, Number(item.cost_total) || 0),
        0
      );
      const {
        postPosSaleAccountingJournals,
        buildSplitAccountingAmounts,
      } = await import('@/lib/pos/accounting-posting');
      const accounting = await postPosSaleAccountingJournals({
        db,
        orderId,
        userId: sessionUserId,
        paymentMethod: payment_method,
        documentId: paymentRow?.id || splitId,
        documentType: 'pos_split_payment',
        amountsOverride: buildSplitAccountingAmounts({
          subtotal: Number(split.subtotal) || 0,
          discount_amount: Number(split.discount_amount) || 0,
          tax_amount: Number(split.tax_amount) || 0,
          total_amount: splitTotal,
          amount_paid: amountPaid,
          orderTotal: Number(orderRow?.total_amount) || splitTotal,
          orderCogs,
          service_charge_amount: Number(orderRow?.service_charge_amount) || 0,
          other_charges_amount: Number(orderRow?.other_charges_amount) || 0,
        }),
      });
      accountingNote = accounting.note;
    } catch (err) {
      if (err instanceof AccountingPostError) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
      }
      throw err;
    }

    const crmXp = await awardCrmXpForSplitPayment(db, {
      orderId,
      splitId,
      customerId: split.customer_id || null,
      totalAmount: splitTotal,
      outletId: split.branch_id || null,
      paymentMethod: payment_method,
    });

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        split_id: splitId,
        change: changeAmount,
        paid_splits: paidSplits || 0,
        total_splits: totalSplits || 0,
        payment_status: paymentStatus,
        crm_xp: crmXp,
      },
      message: accountingNote || undefined,
    });
  } catch (error: unknown) {
    console.error('Error paying split:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
