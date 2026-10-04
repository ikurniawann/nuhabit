// EPIC-039 Fase F — mapping listing marketplace ↔ produk/SKU lokal.

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import {
  createMarketplaceLink,
  deleteMarketplaceLink,
  linkCreateSchema,
  listMarketplaceLinks,
  requireUuid,
} from '@/lib/shop/marketplace/accounts';

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const accountId = requireUuid(request.nextUrl.searchParams.get('account_id'), 'account_id');
  return NextResponse.json({ success: true, data: await listMarketplaceLinks(accountId) });
}, 'shop.marketplace.links.GET');

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  const parsed = linkCreateSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest('Payload tidak valid');
  const inserted = await createMarketplaceLink(parsed.data);
  return NextResponse.json({ success: true, data: inserted }, { status: 201 });
}, 'shop.marketplace.links.POST');

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.shop);
  await deleteMarketplaceLink(requireUuid(request.nextUrl.searchParams.get('id'), 'id'));
  return NextResponse.json({ success: true });
}, 'shop.marketplace.links.DELETE');
