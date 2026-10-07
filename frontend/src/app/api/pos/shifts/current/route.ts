import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

/** GET /api/pos/shifts/current?cashier_id=uuid
 *  Returns the currently active shift for a cashier, or null
 */
export async function GET(request: NextRequest) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const cashierId = searchParams.get('cashier_id');

  if (!cashierId) {
    return NextResponse.json({ success: false, error: 'cashier_id required' }, { status: 400 });
  }

  const db = createPgClient();

  const { data, error } = await db
    .from('pos_shifts')
    .select('*, pos_orders(id)')
    .eq('cashier_id', cashierId)
    .eq('status', 'active')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}
