import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

/** GET /api/pos/shifts — list shifts with optional filters */
export async function GET(request: NextRequest) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const cashierId = searchParams.get('cashier_id');
  const date = searchParams.get('date');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const db = createPgClient();
  
  let query = db
    .from('pos_shifts')
    .select('*, pos_orders(id, total_amount, payment_method, amount_paid, ark_coins_used)', { count: 'exact' })
    .order('opened_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (cashierId) query = query.eq('cashier_id', cashierId);
  if (date) {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    query = query.gte('opened_at', start).lte('opened_at', end);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data, count });
}

/** POST /api/pos/shifts — open new shift */
export async function POST(request: NextRequest) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { cashier_id, opening_cash = 0, notes = '' } = body;

  if (!cashier_id) {
    return NextResponse.json({ success: false, error: 'cashier_id required' }, { status: 400 });
  }

  const db = createPgClient();

  // Check if cashier already has active shift
  const { data: activeShift, error: activeError } = await db
    .from('pos_shifts')
    .select('id, shift_number, opened_at')
    .eq('cashier_id', cashier_id)
    .eq('status', 'active')
    .maybeSingle();

  if (activeError) {
    return NextResponse.json({ success: false, error: activeError.message }, { status: 500 });
  }

  if (activeShift) {
    return NextResponse.json(
      { success: false, error: 'Cashier already has an active shift', active_shift: activeShift },
      { status: 409 }
    );
  }

  // Generate shift number via RPC
  const { data: shiftNum, error: rpcError } = await db.rpc('generate_shift_number');
  if (rpcError) {
    console.error('RPC generate_shift_number error:', rpcError);
    return NextResponse.json({ success: false, error: 'Failed to generate shift number' }, { status: 500 });
  }

  const { data: newShift, error: insertError } = await db
    .from('pos_shifts')
    .insert({
      shift_number: shiftNum || `SHF-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-001`,
      cashier_id,
      opening_cash: Number(opening_cash),
      notes,
      status: 'active',
      opened_by: session || 'system',
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: newShift });
}
