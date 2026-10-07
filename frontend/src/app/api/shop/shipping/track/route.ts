// EPIC-039 Fase C — lacak resi via provider aktif (Biteship tracking API /
// RajaOngkir track/waybill). Dipakai manajemen pesanan (Fase E) & uji admin.

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, getPosSession } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { loadShippingContext } from '@/lib/shop/shipping';

export const GET = apiHandler(async (request: NextRequest) => {
  if (!(await getPosSession())) throw ApiError.unauthorized();

  const waybill = String(request.nextUrl.searchParams.get('waybill') || '').trim();
  const courier = String(request.nextUrl.searchParams.get('courier') || '').trim().toLowerCase();
  if (!waybill || !courier) {
    throw ApiError.badRequest('Parameter waybill dan courier wajib diisi');
  }

  const { provider } = await loadShippingContext();
  const tracking = await provider.getTracking(waybill, courier);
  return NextResponse.json({ success: true, data: tracking });
}, 'shop.shipping.track.GET');
