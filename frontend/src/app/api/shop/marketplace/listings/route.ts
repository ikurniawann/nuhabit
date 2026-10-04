// EPIC-039 Fase F — daftar listing Shopee sebuah akun (utk mapping).

import { NextRequest, NextResponse } from 'next/server';
import { requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { getMarketplaceAccount, requireUuid } from '@/lib/shop/marketplace/accounts';
import { ensureFreshToken, resolveMarketplaceAdapter } from '@/lib/shop/marketplace/sync';

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const accountId = requireUuid(request.nextUrl.searchParams.get('account_id'), 'account_id');
  const fresh = await ensureFreshToken(await getMarketplaceAccount(accountId));
  const listings = await resolveMarketplaceAdapter(fresh.channel_code).listListings(fresh);
  return NextResponse.json({ success: true, data: listings });
}, 'shop.marketplace.listings.GET');
