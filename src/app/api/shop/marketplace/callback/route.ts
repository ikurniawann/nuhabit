// EPIC-039 Fase F — redirect balik dari otorisasi Shopee (?code&shop_id).
// Butuh sesi admin (owner memulai dari dashboard di browser yang sama).
// Galat setelah sesi valid selalu dikembalikan sebagai redirect ke dashboard.

import { NextRequest, NextResponse } from 'next/server';
import { requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { connectShopeeAccount } from '@/lib/shop/marketplace/accounts';
import { MarketplaceError } from '@/lib/shop/marketplace/sync';

const DASHBOARD_URL = '/dashboard/shop/marketplace';

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const redirectTo = (query: string) =>
    NextResponse.redirect(new URL(`${DASHBOARD_URL}?${query}`, request.url));

  const code = String(request.nextUrl.searchParams.get('code') || '').trim();
  const shopId = String(request.nextUrl.searchParams.get('shop_id') || '').trim();
  if (!code || !shopId) return redirectTo('error=callback-kosong');

  try {
    await connectShopeeAccount(code, shopId);
  } catch (error: unknown) {
    console.error('[marketplace] callback error:', error);
    const message = error instanceof MarketplaceError ? error.message : 'Gagal menghubungkan toko';
    return redirectTo(`error=${encodeURIComponent(message)}`);
  }
  return redirectTo(`connected=${shopId}`);
}, 'shop.marketplace.callback.GET');
