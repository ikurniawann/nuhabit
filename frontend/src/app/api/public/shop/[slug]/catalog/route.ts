// EPIC-039 Fase D — katalog publik storefront (tanpa auth, rate-limited).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import {
  buildShopCatalog,
  releaseExpiredReservations,
  resolveStorefront,
} from '@/lib/shop/storefront-server';
import { DEFAULT_STOREFRONT_SETTINGS } from '@/lib/shop/types';

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    const ip = clientIpFrom(request.headers);
    if (!checkRateLimit(`shop-catalog:${ip}`, { limit: 60, windowMs: 60_000 })) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const { slug } = await params;
    const storefront = await resolveStorefront(slug);
    if (!storefront) throw ApiError.notFound('Store not found');

    // Opportunistik: reservasi kedaluwarsa dirilis supaya stok katalog akurat
    await releaseExpiredReservations();

    const products = await buildShopCatalog();
    return NextResponse.json({
      success: true,
      data: {
        storefront: {
          slug: storefront.slug,
          name: storefront.name,
          description: storefront.description,
          settings: DEFAULT_STOREFRONT_SETTINGS,
          pickupBranches: [],
          banner: null,
        },
        collections: [],
        products,
      },
    });
  },
  'shop.public.catalog.GET'
);
