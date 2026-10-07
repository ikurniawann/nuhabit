// EPIC-039 Fase D — cek tarif utk checkout publik. Berat dihitung SERVER
// dari isi keranjang (bukan dari klien) supaya ongkir tidak bisa dimanipulasi.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { loadShippingContext, quoteFromOrigin, withMarkup } from '@/lib/shop/shipping';
import { computeCartWeightAndValue, resolveStorefront } from '@/lib/shop/storefront-server';

const bodySchema = z.object({
  destination_id: z.string().min(1),
  destination_postal_code: z.string().nullish(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().positive().max(999),
      })
    )
    .min(1)
    .max(50),
});

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    const ip = clientIpFrom(request.headers);
    if (!checkRateLimit(`shop-rates:${ip}`, { limit: 20, windowMs: 60_000 })) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const { slug } = await params;
    if (!(await resolveStorefront(slug))) throw ApiError.notFound('Store not found');

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw ApiError.badRequest('Invalid payload');

    // Berat & nilai barang dihitung dari katalog server
    const cargo = await computeCartWeightAndValue(parsed.data.items);
    if (cargo.weightGram <= 0) throw ApiError.badRequest('Invalid cart');

    const context = await loadShippingContext();
    if (!context.originId) throw new ApiError(503, 'The store has not set a shipping origin yet');

    const quotes = await quoteFromOrigin(
      context,
      context.originId,
      { id: parsed.data.destination_id, postalCode: parsed.data.destination_postal_code ?? null },
      cargo
    );
    return NextResponse.json({
      success: true,
      data: withMarkup(quotes, context.markup),
      meta: { provider: context.provider.name, weight_gram: cargo.weightGram },
    });
  },
  'shop.public.rates.POST'
);
