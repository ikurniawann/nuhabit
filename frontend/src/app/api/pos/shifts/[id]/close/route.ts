import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { summarizeShiftOrders } from '@/lib/pos/shift-totals';
import { summarizeMemberBillShiftPayments } from '@/lib/pos/member-bill';

/** PATCH /api/pos/shifts/{id}/close
 *  Body: { closing_cash: number, notes?: string }
 */
export async function PATCH(
  request: NextRequest,
  // Next 16: params adalah Promise — akses sinkron membuat id undefined.
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: shiftId } = await params;
  if (!shiftId) {
    return NextResponse.json({ success: false, error: 'Shift ID required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { closing_cash, notes } = body;

  if (closing_cash === undefined || closing_cash === null) {
    return NextResponse.json({ success: false, error: 'closing_cash required' }, { status: 400 });
  }

  const db = createPgClient();

  // Verify shift exists and is active
  const { data: shift, error: fetchError } = await db
    .from('pos_shifts')
    .select('id, status, opening_cash')
    .eq('id', shiftId)
    .single();

  if (fetchError || !shift) {
    return NextResponse.json({ success: false, error: 'Shift not found' }, { status: 404 });
  }

  if (shift.status !== 'active') {
    return NextResponse.json({ success: false, error: 'Shift is not active' }, { status: 400 });
  }

  // Recalculate expected cash from pos_orders only — never pos_checkouts totals.
  const { data: agg, error: aggError } = await db
    .from('pos_orders')
    .select('total_amount, amount_paid, ark_coins_used, payment_method, payment_method_code')
    .eq('shift_id', shiftId)
    .in('payment_status', ['paid', 'partial'])
    .not('status', 'eq', 'cancelled');

  if (aggError) {
    return NextResponse.json({ success: false, error: aggError.message }, { status: 500 });
  }

  const rows = agg || [];
  const {
    cash: totalCash,
    qris: totalQris,
    debit: totalDebit,
    credit: totalCredit,
    arkCoin: totalArk,
    nfcTab: totalNfcTab,
  } = summarizeShiftOrders(rows);

  // Cicilan Tagihan Member yang diterima di shift ini — tunainya ada di laci
  // (owner 2026-10-01). Bukan penjualan: order-nya ditutup dgn metode
  // 'member_bill' yang tidak masuk hitungan di atas, jadi tidak dobel.
  const { data: memberBillRows, error: memberBillError } = await db
    .from('pos_member_bill_payments')
    .select('amount, payment_method, payment_method_code')
    .eq('shift_id', shiftId);
  if (memberBillError) {
    return NextResponse.json({ success: false, error: memberBillError.message }, { status: 500 });
  }
  const memberBill = summarizeMemberBillShiftPayments(memberBillRows || []);

  const expectedCash = Number(shift.opening_cash) + totalCash + memberBill.cash;
  const totalSales = totalCash + totalQris + totalDebit + totalCredit + totalArk;
  const variance = Number(closing_cash) - expectedCash;

  const { data: updated, error: updateError } = await db
    .from('pos_shifts')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: session || 'system',
      closing_cash: Number(closing_cash),
      expected_cash: expectedCash,
      total_cash_sales: totalCash,
      total_qris_sales: totalQris,
      total_debit_sales: totalDebit,
      total_credit_sales: totalCredit,
      total_ark_coin_sales: totalArk,
      total_sales: totalSales,
      total_orders: rows.length,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shiftId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: updated,
    summary: {
      total_orders: rows.length,
      total_sales: totalSales,
      opening_cash: shift.opening_cash,
      expected_cash: expectedCash,
      closing_cash: Number(closing_cash),
      variance,
      method_breakdown: { cash: totalCash, qris: totalQris, debit: totalDebit, credit: totalCredit, ark_coin: totalArk, nfc_tab: totalNfcTab },
      member_bill_payments: memberBill,
    },
  });
}
