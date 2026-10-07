// EPIC-039 Fase C — cek tarif kurir dari origin toko (settings) ke tujuan.
// Dipakai panel uji di settings admin dan checkout storefront (Fase D).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, getPosSession } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { loadShippingContext, quoteFromOrigin, withMarkup } from '@/lib/shop/shipping';

type RatesBody = {
  destination_id?: string;
  destination_postal_code?: string | null;
  weight_gram?: number | string;
  item_value?: number | string;
};

export const POST = apiHandler(async (request: NextRequest) => {
  if (!(await getPosSession())) throw ApiError.unauthorized();

  const body = (await request.json()) as RatesBody;
  const destinationId = String(body.destination_id || '').trim();
  const weightGram = Number(body.weight_gram);
  if (!destinationId) throw ApiError.badRequest('Tujuan wajib dipilih');
  if (!Number.isFinite(weightGram) || weightGram <= 0) {
    throw ApiError.badRequest('Berat (gram) wajib angka > 0 — isi berat produk di master');
  }

  const context = await loadShippingContext();
  if (!context.originId) {
    throw ApiError.badRequest('Alamat origin toko belum diatur di Settings → Pengiriman');
  }

  const quotes = await quoteFromOrigin(
    context,
    context.originId,
    { id: destinationId, postalCode: body.destination_postal_code ?? null },
    { weightGram, itemValue: Number(body.item_value) || 0 }
  );
  const { markup } = context;
  return NextResponse.json({
    success: true,
    data: withMarkup(quotes, markup).map((quote) => ({ ...quote, markup })),
    meta: { provider: context.provider.name, markup },
  });
}, 'shop.shipping.rates.POST');
