import { getCrmDefaultVenue } from '@/lib/crm/server';
import { normalizeGuestCount } from '@/lib/pos/guest-count';
import { backfillMissingItemStations } from '@/lib/pos/kitchen-station';
import { hasTrackedMerchandise } from '@/lib/pos/merchandise-stock';
import { ensureQueueNumber } from '@/lib/pos/queue-number';
import { orderError, type OrderContext, type OrderResponse } from './order-types';

/** Split bill lewat RPC lama `pos_create_split_order_transaction`. */
export async function createSplitOrder(
  { db, req, cashierId, sellWarehouseId, soldFrom, giftCardNominals }: OrderContext,
  splits: unknown[]
): Promise<OrderResponse> {
  // EPIC-034 Fase B — satu gift card tidak bisa dibagi ke beberapa pembayar (MVP).
  if (giftCardNominals.length > 0) {
    return orderError(400, 'Gift card belum didukung untuk split bill');
  }
  // EPIC-032 C1 — promo belum didukung utk split bill (MVP)
  if (String(req.promo_code || '').trim()) {
    return orderError(400, 'Kode promo belum didukung untuk split bill');
  }
  // EPIC-039 Fase A — RPC split tidak tahu deduksi stok merchandise (MVP).
  if (await hasTrackedMerchandise(db, req.items)) {
    return orderError(400, 'Merchandise belum didukung untuk split bill');
  }

  const { data: rpcResult, error: rpcError } = await db.rpc('pos_create_split_order_transaction', {
    p_order_type: req.order_type,
    p_customer_id: req.customer_id || null,
    p_cashier_id: cashierId,
    p_server_id: req.server_id || null,
    p_table_id: req.table_id || null,
    p_subtotal: Number(req.subtotal) || 0,
    p_discount_amount: Number(req.discount_amount) || 0,
    p_discount_reason: req.discount_reason || null,
    p_tax_amount: req.include_tax ? Number(req.tax_amount) || 0 : 0,
    p_service_charge_amount: Number(req.service_charge_amount) || 0,
    p_total_amount: Number(req.total_amount) || 0,
    p_notes: req.notes || null,
    p_special_requests: req.special_requests || null,
    p_items: req.items,
    p_splits: splits,
    p_branch_id: req.branch_id || null,
  });
  if (rpcError) {
    console.error('RPC split error:', rpcError);
    return orderError(500, rpcError.message);
  }
  const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
  if (!result?.success) {
    return orderError(400, result?.error || 'Split order creation failed');
  }

  if (req.shift_id) {
    await db.from('pos_orders').update({ shift_id: req.shift_id }).eq('id', result.order_id);
  }

  // Jumlah tamu di-set setelah RPC (signature RPC tetap; mengubahnya berarti
  // migrasi function). Tanpa ini split bill, yang hampir pasti banyak orang,
  // tercatat 1 tamu karena DEFAULT kolomnya.
  await db
    .from('pos_orders')
    .update({ guest_count: normalizeGuestCount(req.guest_count) })
    .eq('id', result.order_id);

  const venue = await getCrmDefaultVenue(db);
  await db
    .from('pos_orders')
    .update({
      company_id: venue.companyId,
      branch_id: req.branch_id || venue.branchId,
      warehouse_id: sellWarehouseId,
      sold_from: soldFrom,
    })
    .eq('id', result.order_id);
  await ensureQueueNumber(db, {
    id: result.order_id,
    company_id: venue.companyId,
    branch_id: req.branch_id || venue.branchId,
  });
  await backfillMissingItemStations(db, result.order_id);

  const { data: completeOrder } = await db
    .from('pos_orders')
    .select(`*, customer:pos_customers(name, phone), items:pos_order_items(*), splits:pos_order_splits(*)`)
    .eq('id', result.order_id)
    .single();

  return { status: 201, body: { success: true, data: completeOrder || result } };
}
