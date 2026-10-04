// EPIC-039 Fase F — daftar akun marketplace + ubah buffer/putuskan koneksi.

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import {
  accountPatchSchema,
  listMarketplaceAccounts,
  updateMarketplaceAccount,
} from '@/lib/shop/marketplace/accounts';

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.shop);
  return NextResponse.json({ success: true, data: await listMarketplaceAccounts() });
}, 'shop.marketplace.accounts.GET');

export const PATCH = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const parsed = accountPatchSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest('Payload tidak valid');
  return NextResponse.json({ success: true, data: await updateMarketplaceAccount(parsed.data) });
}, 'shop.marketplace.accounts.PATCH');
