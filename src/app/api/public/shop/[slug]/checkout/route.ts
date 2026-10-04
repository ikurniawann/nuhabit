// EPIC-039 Fase D — checkout publik: validasi keranjang server-side, ongkir
// dihitung ulang server (kurir dipilih klien, HARGA dari provider), klaim
// stok + reservasi TTL, invoice Xendit → redirect.

import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { z } from 'zod';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  parseCourierList,
  resolveOriginId,
  resolveShippingProvider,
  ShippingProviderError,
} from '@/lib/shop/shipping';
import {
  computeCartWeightAndValue,
  processShopCheckout,
  releaseExpiredReservations,
  resolveStorefront,
} from '@/lib/shop/storefront-server';

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        sku_id: z.string().uuid().nullish(),
        quantity: z.number().int().positive().max(999),
      })
    )
    .min(1)
    .max(50),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(30),
    email: z.string().trim().email().max(160).nullish().or(z.literal('')),
  }),
  destination: z.object({
    area_id: z.string().min(1),
    label: z.string().trim().min(3).max(300),
    postal_code: z.string().trim().max(10).nullish(),
    address: z.string().trim().min(10).max(500),
  }),
  courier: z.object({
    code: z.string().trim().min(1).max(30),
    service_code: z.string().trim().min(1).max(60),
  }),
  notes: z.string().trim().max(500).nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`shop-checkout:${ip}`, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { slug } = await params;
    const storefront = await resolveStorefront(slug);
    if (!storefront) {
      return NextResponse.json({ success: false, error: 'Toko tidak ditemukan' }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Data checkout tidak lengkap/valid' },
        { status: 400 }
      );
    }
    const body = parsed.data;

    await releaseExpiredReservations();

    // Ongkir otoritatif: hitung ulang dari provider, cocokkan pilihan klien
    const { weightGram, itemValue } = await computeCartWeightAndValue(body.items);
    if (weightGram <= 0) {
      return NextResponse.json({ success: false, error: 'Keranjang tidak valid' }, { status: 400 });
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const originId = resolveOriginId(settings);
    if (!originId) {
      return NextResponse.json(
        { success: false, error: 'Toko belum mengatur alamat pengiriman' },
        { status: 503 }
      );
    }

    const provider = resolveShippingProvider(settings.provider);
    const quotes = await provider.getRates({
      originId,
      originPostalCode: settings.origin_postal_code,
      destinationId: body.destination.area_id,
      destinationPostalCode: body.destination.postal_code ?? null,
      weightGram,
      itemValue,
      couriers: parseCourierList(settings.couriers),
    });

    const chosen = quotes.find(
      (quote) =>
        quote.courierCode.toLowerCase() === body.courier.code.toLowerCase() &&
        quote.serviceCode.toLowerCase() === body.courier.service_code.toLowerCase() &&
        quote.price > 0
    );
    if (!chosen) {
      return NextResponse.json(
        { success: false, error: 'Layanan kurir tidak tersedia lagi — pilih ulang ongkir' },
        { status: 409 }
      );
    }
    const markup = Number(settings.markup_amount) || 0;

    const baseUrl = appOrigin(request);

    const result = await processShopCheckout({
      storefront,
      items: body.items.map((item) => ({
        product_id: item.product_id,
        sku_id: item.sku_id ?? null,
        quantity: item.quantity,
      })),
      customer: {
        name: body.customer.name,
        phone: body.customer.phone,
        email: body.customer.email || null,
      },
      destination: {
        areaId: body.destination.area_id,
        label: body.destination.label,
        postalCode: body.destination.postal_code ?? null,
        address: body.destination.address,
      },
      courier: {
        code: chosen.courierCode,
        serviceCode: chosen.serviceCode,
        provider: provider.name,
        cost: chosen.price + markup,
      },
      notes: body.notes ?? null,
      baseUrl,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.reason },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          order_number: result.orderNumber,
          invoice_url: result.invoiceUrl,
          status_url: `${baseUrl}/shop/order/${result.accessToken}`,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[shop] checkout error:', error);
    return NextResponse.json({ success: false, error: 'Checkout gagal — coba lagi' }, { status: 500 });
  }
}
