// EPIC-039 Fase C — settings modul kurir (admin): provider, origin, kurir, markup.

import { NextRequest, NextResponse } from 'next/server';
import { requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { createPgClient } from '@/lib/pg/create-client';
import { getOrCreateShippingSettings } from '@/lib/shop/shipping';
import { buildShippingSettingsPatch, updateShippingSettings } from '@/lib/shop/shipping/settings';

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.shop);
  const settings = await getOrCreateShippingSettings(createPgClient());
  return NextResponse.json({ success: true, data: settings });
}, 'shop.shipping.settings.GET');

export const PATCH = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.shop);
  const patch = buildShippingSettingsPatch((await request.json()) as Record<string, unknown>);
  const data = await updateShippingSettings(patch, user.id);
  return NextResponse.json({ success: true, data });
}, 'shop.shipping.settings.PATCH');
