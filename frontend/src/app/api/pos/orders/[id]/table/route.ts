import { NextRequest } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { table_id, order_type } = body;
    const { id: orderId } = await params;

    const db = createPgClient();

    // 1. Check order exists and is active
    const { data: order, error: orderErr } = await db
      .from('pos_orders')
      .select('id, status, table_id, checkout_id, payment_status')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return Response.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const activeStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'served'];
    if (!activeStatuses.includes(order.status as string)) {
      return Response.json({ success: false, error: 'Cannot move finished order' }, { status: 400 });
    }

    // A table may already have other open bills (stall + central). Moving
    // this order onto it must not 409 — it becomes another bill on that table.
    const newTableId = table_id || null;

    // 3. Update order
    const updatePayload: Record<string, string | null> = { updated_at: new Date().toISOString() };
    if (newTableId !== undefined) updatePayload.table_id = newTableId;
    if (order_type) updatePayload.order_type = order_type;

    const checkoutId =
      (order as { checkout_id?: string | null }).checkout_id || null;

    if (checkoutId) {
      const { error: childrenErr } = await db
        .from('pos_orders')
        .update(updatePayload)
        .eq('checkout_id', checkoutId)
        .neq('payment_status', 'paid')
        .in('status', activeStatuses);
      if (childrenErr) throw childrenErr;

      const checkoutUpdate: Record<string, string | null> = {
        updated_at: updatePayload.updated_at as string,
      };
      if (newTableId !== undefined) checkoutUpdate.table_id = newTableId;
      const { error: checkoutErr } = await db
        .from('pos_checkouts')
        .update(checkoutUpdate)
        .eq('id', checkoutId)
        .neq('payment_status', 'paid');
      if (
        checkoutErr &&
        checkoutErr.code !== '42703' &&
        checkoutErr.code !== 'PGRST204'
      ) {
        throw checkoutErr;
      }
    } else {
      const { error: updErr } = await db
        .from('pos_orders')
        .update(updatePayload)
        .eq('id', orderId);

      if (updErr) throw updErr;
    }

    return Response.json({
      success: true,
      data: {
        order_id: orderId,
        new_table_id: newTableId,
        new_order_type: order_type || undefined,
        message: 'Order moved successfully',
      },
    });
  } catch (error: unknown) {
    console.error('Move table error:', error);
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Move table failed' }, { status: 500 });
  }
}
