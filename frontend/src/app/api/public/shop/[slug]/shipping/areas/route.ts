// EPIC-039 Fase D — pencarian area tujuan utk checkout publik (rate-limited).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { loadShippingContext } from '@/lib/shop/shipping';
import { resolveStorefront } from '@/lib/shop/storefront-server';

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    const ip = clientIpFrom(request.headers);
    if (!checkRateLimit(`shop-areas:${ip}`, { limit: 30, windowMs: 60_000 })) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const { slug } = await params;
    if (!(await resolveStorefront(slug))) throw ApiError.notFound('Store not found');

    const query = String(request.nextUrl.searchParams.get('q') || '').trim();
    if (query.length < 3) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { provider } = await loadShippingContext();
    return NextResponse.json({ success: true, data: await provider.searchAreas(query) });
  },
  'shop.public.areas.GET'
);
