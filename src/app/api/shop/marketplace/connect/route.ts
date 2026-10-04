// EPIC-039 Fase F — mulai otorisasi toko Shopee: kembalikan URL auth_partner.

import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { resolveMarketplaceAdapter } from '@/lib/shop/marketplace/sync';

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const baseUrl = appOrigin(request);
  const authUrl = resolveMarketplaceAdapter('shopee').buildAuthUrl(
    `${baseUrl}/api/shop/marketplace/callback`
  );
  return NextResponse.json({ success: true, data: { auth_url: authUrl } });
}, 'shop.marketplace.connect.GET');
