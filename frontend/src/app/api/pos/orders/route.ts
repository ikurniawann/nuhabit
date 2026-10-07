import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { createPosOrder } from '@/lib/pos/orders/create-order';
import { listPosOrders, parseOrderListFilters } from '@/lib/pos/orders/list-orders';
import type { PosOrderBody } from '@/lib/pos/orders/order-types';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

// GET /api/pos/orders — list orders with filters
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const parsed = parseOrderListFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }
  try {
    const data = await listPosOrders(parsed.filters);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

// POST /api/pos/orders — checkout campuran, split bill, atau order tunggal
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  let body: PosOrderBody;
  try {
    body = (await request.json()) as PosOrderBody;
  } catch (error: unknown) {
    console.error('Error creating order:', error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
  const { status, body: responseBody } = await createPosOrder(body, sessionUserId);
  return NextResponse.json(responseBody, { status });
}
