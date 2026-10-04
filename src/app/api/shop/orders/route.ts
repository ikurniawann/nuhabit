// EPIC-039 Fase E — daftar pesanan toko online (back-office).

import { NextRequest, NextResponse } from 'next/server';
import { requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { listShopOrders, parseShopOrderListFilter } from '@/lib/shop/orders';

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const rows = await listShopOrders(parseShopOrderListFilter(request.nextUrl.searchParams));
  return NextResponse.json({ success: true, data: rows });
}, 'shop.orders.GET');
