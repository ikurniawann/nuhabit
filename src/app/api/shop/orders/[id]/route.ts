// EPIC-039 Fase E — detail & transisi status pesanan toko online.

import { NextRequest, NextResponse } from 'next/server';
import { requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { assertOrderId, getShopOrderDetail, transitionShopOrder } from '@/lib/shop/orders';

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.shop);
  const { id } = await params;
  assertOrderId(id);
  return NextResponse.json({ success: true, data: await getShopOrderDetail(id) });
}, 'shop.orders.detail.GET');

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.shop);
  const { id } = await params;
  assertOrderId(id);

  const body = (await request.json()) as { status?: string; note?: string };
  const updated = await transitionShopOrder(
    id,
    String(body.status || '').trim(),
    body.note?.trim() || null
  );
  return NextResponse.json({ success: true, data: updated });
}, 'shop.orders.detail.PATCH');
