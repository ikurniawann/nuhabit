// EPIC-039 Fase D — status order publik by access_token (pola booking status).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { loadPublicOrderStatus } from '@/lib/shop/order-status';

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
    const ip = clientIpFrom(request.headers);
    if (!checkRateLimit(`shop-order-status:${ip}`, { limit: 60, windowMs: 60_000 })) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const { token } = await params;
    const order = z.string().uuid().safeParse(token).success
      ? await loadPublicOrderStatus(token)
      : null;
    if (!order) throw ApiError.notFound('Order tidak ditemukan');
    return NextResponse.json({ success: true, data: order });
  },
  'shop.public.order-status.GET'
);
