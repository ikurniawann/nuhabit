import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

type SplitPayload = {
  label?: string;
  subtotal?: number | string;
  tax_amount?: number | string;
  discount_amount?: number | string;
  total_amount?: number | string;
  customer_id?: string;
  items?: {
    order_item_index?: number;
    quantity?: number | string;
    unit_price?: number | string;
  }[];
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

// GET /api/pos/orders/{id}/splits
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const db = createPgClient();
    const { data, error } = await db.rpc('pos_get_order_splits', { p_order_id: id });

    if (error) {
      console.error('Error fetching splits:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('Error fetching splits:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

// POST /api/pos/orders/{id}/splits
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const splits = Array.isArray(body?.splits) ? body.splits as SplitPayload[] : [];

    if (splits.length < 2) {
      return NextResponse.json({ success: false, error: 'Minimal 2 split diperlukan' }, { status: 400 });
    }

    const db = createPgClient();

    const { data: order, error: orderError } = await db
      .from('pos_orders')
      .select('id, order_number, status, payment_status, total_amount')
      .eq('id', id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, error: orderError?.message || 'Order tidak ditemukan' }, { status: 404 });
    }

    if (['completed', 'cancelled', 'voided', 'merged'].includes(order.status || '')) {
      return NextResponse.json({ success: false, error: 'Order sudah tidak bisa di-split' }, { status: 400 });
    }

    if (order.payment_status === 'paid') {
      return NextResponse.json({ success: false, error: 'Order sudah lunas' }, { status: 400 });
    }

    const { count: existingSplitCount, error: existingError } = await db
      .from('pos_order_splits')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', id)
      .neq('status', 'cancelled');

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }

    if ((existingSplitCount || 0) > 0) {
      return NextResponse.json({ success: false, error: 'Order ini sudah memiliki split bill' }, { status: 400 });
    }

    const { data: orderItems, error: itemsError } = await db
      .from('pos_order_items')
      .select('id, quantity, unit_price')
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    if (itemsError) {
      return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
    }

    const orderTotal = toNumber(order.total_amount);
    const splitTotal = splits.reduce((sum, split) => sum + toNumber(split.total_amount), 0);

    if (Math.round(splitTotal) !== Math.round(orderTotal)) {
      return NextResponse.json(
        { success: false, error: `Total split ${splitTotal} tidak sama dengan total order ${orderTotal}` },
        { status: 400 }
      );
    }

    const insertedSplits = [];

    for (let index = 0; index < splits.length; index += 1) {
      const split = splits[index];
      const { data: insertedSplit, error: splitError } = await db
        .from('pos_order_splits')
        .insert({
          order_id: id,
          split_index: index + 1,
          label: split.label || `Split ${index + 1}`,
          subtotal: toNumber(split.subtotal),
          tax_amount: toNumber(split.tax_amount),
          discount_amount: toNumber(split.discount_amount),
          total_amount: toNumber(split.total_amount),
          customer_id: split.customer_id || null,
          status: 'pending',
        })
        .select('id, split_index, label, total_amount, status')
        .single();

      if (splitError || !insertedSplit) {
        return NextResponse.json({ success: false, error: splitError?.message || 'Gagal membuat split' }, { status: 500 });
      }

      insertedSplits.push(insertedSplit);

      if (Array.isArray(split.items) && split.items.length > 0) {
        const splitItems = split.items
          .map((item) => {
            const orderItem = orderItems?.[Number(item.order_item_index)];
            if (!orderItem) return null;
            const quantity = Math.max(0, Math.floor(toNumber(item.quantity) || 0));
            if (quantity <= 0) return null;
            const unitPrice = toNumber(item.unit_price) || toNumber(orderItem.unit_price);
            return {
              split_id: insertedSplit.id,
              order_item_id: orderItem.id,
              quantity,
              subtotal: unitPrice * quantity,
              total_amount: unitPrice * quantity,
            };
          })
          .filter(Boolean);

        if (splitItems.length > 0) {
          const { error: splitItemsError } = await db
            .from('pos_order_split_items')
            .insert(splitItems);

          if (splitItemsError) {
            return NextResponse.json({ success: false, error: splitItemsError.message }, { status: 500 });
          }
        }
      }
    }

    await db.from('pos_order_status_history').insert({
      order_id: id,
      status: order.status || 'pending',
      reason: `Split bill dibuat: ${splits.length} bill(s)`,
    });

    return NextResponse.json({
      success: true,
      data: {
        order_id: id,
        order_number: order.order_number,
        split_count: insertedSplits.length,
        splits: insertedSplits,
      },
    });
  } catch (error: unknown) {
    console.error('Error creating order splits:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
