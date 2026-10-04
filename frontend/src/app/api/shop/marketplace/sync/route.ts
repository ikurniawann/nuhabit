// EPIC-039 Fase F — sinkron manual satu akun: push stok + pull order.
// Endpoint sama bisa dipanggil cron eksternal dgn header
// x-sync-token = MARKETPLACE_SYNC_TOKEN (tanpa sesi admin).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { safeEqual } from '@/lib/security/compare';
import { getMarketplaceAccount, requireUuid } from '@/lib/shop/marketplace/accounts';
import { pullMarketplaceOrders, pushAllStock } from '@/lib/shop/marketplace/sync';

export const POST = apiHandler(async (request: NextRequest) => {
  if (!safeEqual(request.headers.get('x-sync-token'), process.env.MARKETPLACE_SYNC_TOKEN)) {
    await requireIamMenuPrefix(IAM.shop);
  }

  const body = (await request.json().catch(() => ({}))) as { account_id?: string };
  const account = await getMarketplaceAccount(requireUuid(body.account_id, 'account_id'));
  if (account.status === 'disconnected') {
    throw ApiError.badRequest('Akun terputus — hubungkan ulang');
  }

  // Pull dulu (order memotong stok), baru push (stok terbaru ke marketplace)
  const pull = await pullMarketplaceOrders(account);
  const push = await pushAllStock(account);
  return NextResponse.json({ success: true, data: { pull, push } });
}, 'shop.marketplace.sync.POST');
