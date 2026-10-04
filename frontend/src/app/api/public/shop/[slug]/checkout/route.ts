// EPIC-039 Fase D — checkout publik: validasi keranjang server-side, ongkir
// dihitung ulang server (kurir dipilih klien, HARGA dari provider), klaim
// stok + reservasi TTL, invoice Xendit → redirect.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { appOrigin } from '@/lib/app-origin';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { findQuote, loadShippingContext, quoteFromOrigin } from '@/lib/shop/shipping';
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

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    const ip = clientIpFrom(request.headers);
    if (!checkRateLimit(`shop-checkout:${ip}`, { limit: 10, windowMs: 60_000 })) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const { slug } = await params;
    const storefront = await resolveStorefront(slug);
    if (!storefront) throw ApiError.notFound('Toko tidak ditemukan');

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw ApiError.badRequest('Data checkout tidak lengkap/valid');
    const body = parsed.data;

    await releaseExpiredReservations();

    // Ongkir otoritatif: hitung ulang dari provider, cocokkan pilihan klien
    const cargo = await computeCartWeightAndValue(body.items);
    if (cargo.weightGram <= 0) throw ApiError.badRequest('Keranjang tidak valid');

    const context = await loadShippingContext();
    if (!context.originId) throw new ApiError(503, 'Toko belum mengatur alamat pengiriman');

    const quotes = await quoteFromOrigin(
      context,
      context.originId,
      { id: body.destination.area_id, postalCode: body.destination.postal_code ?? null },
      cargo
    );
    const chosen = findQuote(quotes, body.courier.code, body.courier.service_code);
    if (!chosen) {
      throw ApiError.conflict('Layanan kurir tidak tersedia lagi — pilih ulang ongkir');
    }

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
        provider: context.provider.name,
        cost: chosen.price + context.markup,
      },
      notes: body.notes ?? null,
      baseUrl,
    });
    if (!result.ok) throw new ApiError(result.status, result.reason);

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
  },
  'shop.public.checkout.POST'
);
