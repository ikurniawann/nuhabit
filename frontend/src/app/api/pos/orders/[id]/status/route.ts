import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { requirePosMenu } from '@/lib/api/auth';
import { IAM } from '@/lib/iam/prefixes';
import { restoreMerchandiseStockForOrder } from '@/lib/pos/merchandise-stock';
import { normalizeStation } from '@/lib/pos/kitchen-station';
import { notifyGofoodFoodReadyForPosOrder } from '@/lib/gobiz/service';
import {
  deriveOrderKitchenStatus,
  isFnbStation,
  isTerminalKitchenStatus,
  mapOrderStatusToKitchenStatus,
} from '@/lib/pos/kds-status';

/** PATCH /api/pos/orders/{id}/status
 *  Body: { status: string, station?: string, reason?: string, item_ids?: string[] }
 *  Station-scoped kitchen bump; optional item_ids for per-line siap/sajikan.
 *  order.status is derived from remaining F&B items.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const pos = await requirePosMenu(IAM.posKitchen);
  if (pos.error) return pos.error;

  const resolvedParams = await params;
  const orderId = resolvedParams.id;
  if (!orderId) {
    return NextResponse.json({ success: false, error: 'Order ID required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { status, reason, station: stationRaw, item_ids: itemIdsRaw } = body as {
    status?: string;
    reason?: string;
    station?: string;
    item_ids?: unknown;
  };

  const validStatuses = ['pending','confirmed','preparing','ready','served','completed','cancelled'];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }

  const itemIdFilter = Array.isArray(itemIdsRaw)
    ? [...new Set(itemIdsRaw.map((id) => String(id || '').trim()).filter(Boolean))]
    : null;

  const db = createPgClient();

  const { data: currentOrder, error: fetchError } = await db
    .from('pos_orders')
    .select('status, payment_status')
    .eq('id', orderId)
    .single();

  if (fetchError || !currentOrder) {
    return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const station = stationRaw ? normalizeStation(stationRaw) : null;

  const kitchenStatus = mapOrderStatusToKitchenStatus(status);

  if (status === 'cancelled') {
    const updateData: Record<string, string> = { status: 'cancelled', updated_at: now };
    let { error: updateError } = await db.from('pos_orders').update(updateData).eq('id', orderId);
    if (updateError?.code === '42703' || updateError?.code === 'PGRST204') {
      updateError = (await db.from('pos_orders').update({ status: 'cancelled', updated_at: now }).eq('id', orderId)).error;
    }
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    await restoreMerchandiseStockForOrder(db, orderId);
    if (kitchenStatus) {
      await db
        .from('pos_order_items')
        .update({ kitchen_status: kitchenStatus, updated_at: now })
        .eq('order_id', orderId);
    }
    await db.from('pos_order_status_history').insert({
      order_id: orderId,
      from_status: currentOrder.status,
      to_status: 'cancelled',
      reason: reason || 'Status updated to cancelled',
      changed_at: now,
    });
    return NextResponse.json({
      success: true,
      data: { order_id: orderId, status: 'cancelled', kitchen_status: kitchenStatus },
    });
  }

  const { data: items, error: itemsError } = await db
    .from('pos_order_items')
    .select('id, station, kitchen_status, product_name, kitchen_notes')
    .eq('order_id', orderId);

  if (itemsError && itemsError.code !== '42703' && itemsError.code !== 'PGRST204') {
    return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
  }

  type KitchenItemRow = {
    id: string;
    station?: string | null;
    kitchen_status?: string | null;
    product_name?: string | null;
    kitchen_notes?: string | null;
  };
  const normalizedItems = ((items || []) as KitchenItemRow[]).map((item) => ({
    ...item,
    station: normalizeStation(item.station, item.product_name || '', item.kitchen_notes || ''),
  }));

  const eligibleIds = normalizedItems
    .filter((item) => {
      if (!isFnbStation(item.station)) return false;
      if (isTerminalKitchenStatus(item.kitchen_status) && status !== 'cancelled') return false;
      if (station && item.station !== station) return false;
      return true;
    })
    .map((item) => item.id);

  const targetIds =
    itemIdFilter && itemIdFilter.length > 0
      ? eligibleIds.filter((id) => itemIdFilter.includes(id))
      : eligibleIds;

  if (itemIdFilter && itemIdFilter.length > 0 && targetIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Item tidak ditemukan / sudah selesai di station ini' },
      { status: 400 }
    );
  }

  if (kitchenStatus && targetIds.length > 0) {
    const itemUpdate: Record<string, string | null> = {
      kitchen_status: kitchenStatus,
      updated_at: now,
    };
    if (status === 'preparing') itemUpdate.kitchen_started_at = now;
    if (status === 'ready') itemUpdate.kitchen_ready_at = now;
    if (status === 'served' || status === 'completed') itemUpdate.served_at = now;

    const { error: itemStatusError } = await db
      .from('pos_order_items')
      .update(itemUpdate)
      .in('id', targetIds);

    if (itemStatusError && itemStatusError.code !== '42703' && itemStatusError.code !== 'PGRST204') {
      return NextResponse.json({ success: false, error: itemStatusError.message }, { status: 500 });
    }
  }

  const nextItems = normalizedItems.map((item) =>
    targetIds.includes(item.id)
      ? { ...item, kitchen_status: kitchenStatus || item.kitchen_status }
      : item
  );
  const derived = deriveOrderKitchenStatus(nextItems, currentOrder.payment_status);

  const orderUpdate: Record<string, string> = {
    status: derived.orderStatus,
    updated_at: now,
  };
  if (derived.orderStatus === 'confirmed') orderUpdate.confirmed_at = now;
  if (derived.orderStatus === 'served' || derived.orderStatus === 'completed') {
    orderUpdate.served_at = now;
  }
  if (derived.orderStatus === 'completed') {
    orderUpdate.completed_at = now;
  }

  let { error: updateError } = await db
    .from('pos_orders')
    .update(orderUpdate)
    .eq('id', orderId);

  if (updateError?.code === '42703' || updateError?.code === 'PGRST204') {
    const legacyUpdate = { ...orderUpdate };
    delete legacyUpdate.served_at;
    updateError = (await db.from('pos_orders').update(legacyUpdate).eq('id', orderId)).error;
  }

  if (updateError) {
    console.error('Status update error:', updateError);
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }

  const itemHint =
    itemIdFilter && itemIdFilter.length > 0
      ? ` (item ${targetIds.length}/${itemIdFilter.length})`
      : '';

  await db.from('pos_order_status_history').insert({
    order_id: orderId,
    from_status: currentOrder.status,
    to_status: derived.orderStatus,
    reason:
      reason ||
      `Status updated to ${status}${station ? ` (${station})` : ''}${itemHint}`,
    changed_at: now,
  });

  // EPIC-049: order GoFood yang siap → beri tahu driver/pelanggan via GoBiz
  // (best-effort; kegagalan dicatat di gofood_orders.last_error, tidak
  // menggagalkan bump KDS).
  if (derived.orderStatus === 'ready' || derived.orderStatus === 'served' || derived.orderStatus === 'completed') {
    await notifyGofoodFoodReadyForPosOrder(orderId);
  }

  return NextResponse.json({
    success: true,
    data: {
      order_id: orderId,
      status: derived.orderStatus,
      kitchen_status: derived.kitchenStatus,
      station: station || null,
      item_ids: targetIds,
    },
  });
}
