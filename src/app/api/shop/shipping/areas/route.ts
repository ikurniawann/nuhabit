// EPIC-039 Fase C — cari area/kecamatan tujuan sesuai provider aktif
// (Biteship maps/areas; RajaOngkir domestic-destination).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, getPosSession } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { loadShippingContext } from '@/lib/shop/shipping';

export const GET = apiHandler(async (request: NextRequest) => {
  if (!(await getPosSession())) throw ApiError.unauthorized();

  const query = String(request.nextUrl.searchParams.get('q') || '').trim();
  if (query.length < 3) {
    return NextResponse.json({ success: true, data: [] });
  }

  const { provider } = await loadShippingContext();
  const areas = await provider.searchAreas(query);
  return NextResponse.json({ success: true, data: areas, meta: { provider: provider.name } });
}, 'shop.shipping.areas.GET');
