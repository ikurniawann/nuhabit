import { NextRequest, NextResponse } from 'next/server';
import { IAM } from '@/lib/iam/prefixes';
import { iamActionOrResponse } from '@/lib/pos/route-guards';
import { createPgClient } from "@/lib/pg/create-client";
import { query } from '@/lib/db';
import { normalizeSalesChannels, SALES_CHANNEL_CODES } from '@/lib/pos/sales-channels';
import {
  buildMerchandiseColumns,
  type MerchandiseFieldsPayload,
} from '@/lib/pos/merchandise-fields';

type ProductUpdatePayload = MerchandiseFieldsPayload & {
  xp?: number | string;
  xp_points?: number | string;
  station?: string;
  is_active?: boolean;
  is_available?: boolean;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function withProductXpAlias<T extends Record<string, unknown>>(product: T) {
  return {
    ...product,
    xp: Number(product.xp_points ?? product.xp ?? 0),
    station: typeof product.station === 'string' ? product.station : 'kitchen',
  };
}

function normalizeStation(value?: string) {
  const station = String(value || '').trim().toLowerCase();
  if (['kitchen', 'bar', 'bakery', 'dessert', 'merchandise', 'photobooth'].includes(station)) {
    return station;
  }
  return 'kitchen';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Mengubah data master → izin aksi IAM, bukan sekadar sesi kasir POS.
  const user = await iamActionOrResponse(IAM.posCatalogProducts, "update");
  if (user instanceof Response) return user;

  try {
    const { id } = await params;
    const body = (await request.json()) as ProductUpdatePayload;
    const hasXpUpdate = body.xp_points !== undefined || body.xp !== undefined;
    const hasStationUpdate = body.station !== undefined;
    const hasActiveUpdate = body.is_active !== undefined;
    const hasAvailableUpdate = body.is_available !== undefined;
    // Produk privilege member (EPIC-011 Fase C): null = produk umum
    const hasMinXpUpdate = (body as { min_xp?: unknown }).min_xp !== undefined;
    const rawMinXp = (body as { min_xp?: unknown }).min_xp;
    // Bonus XP per unit saat order member lunas (0 = tanpa bonus)
    const rawBonusXp = (body as { bonus_xp?: unknown }).bonus_xp;
    const hasBonusXpUpdate = rawBonusXp !== undefined;
    const xpPoints = Math.max(0, Number(body.xp_points ?? body.xp ?? 0) || 0);
    const db = createPgClient();
    // Channel penjualan: null = semua channel; array kode = hanya di channel itu.
    const rawSalesChannels = (body as { sales_channels?: unknown }).sales_channels;
    const hasSalesChannelsUpdate = rawSalesChannels !== undefined;
    if (
      hasSalesChannelsUpdate &&
      rawSalesChannels !== null &&
      (!Array.isArray(rawSalesChannels) ||
        rawSalesChannels.some((code) => !(SALES_CHANNEL_CODES as readonly string[]).includes(String(code))))
    ) {
      return NextResponse.json({ success: false, error: 'Channel penjualan tidak valid' }, { status: 400 });
    }
    const updatePayload: Record<string, number | string | boolean | null | string[]> = {
      updated_at: new Date().toISOString(),
    };

    if (hasXpUpdate) updatePayload.xp_points = xpPoints;
    if (hasStationUpdate) updatePayload.station = normalizeStation(body.station);
    if (hasActiveUpdate) updatePayload.is_active = Boolean(body.is_active);
    if (hasAvailableUpdate) updatePayload.is_available = Boolean(body.is_available);
    if (hasSalesChannelsUpdate) updatePayload.sales_channels = normalizeSalesChannels(rawSalesChannels);
    if (hasBonusXpUpdate) {
      const bonusXp = Math.floor(Number(rawBonusXp));
      if (!Number.isFinite(bonusXp) || bonusXp < 0 || bonusXp > 100_000) {
        return NextResponse.json({ success: false, error: 'Bonus XP harus 0–100.000' }, { status: 400 });
      }
      updatePayload.bonus_xp = bonusXp;
    }
    if (hasMinXpUpdate) {
      updatePayload.min_xp =
        rawMinXp === null || rawMinXp === "" || Number(rawMinXp) <= 0
          ? null
          : Math.floor(Number(rawMinXp)) || null;
    }

    // EPIC-039 Fase A — field merchandise (parsial: hanya yang dikirim)
    const merchColumns = buildMerchandiseColumns(body);
    if (!merchColumns.ok) {
      return NextResponse.json({ success: false, error: merchColumns.error }, { status: 400 });
    }
    const hasMerchUpdate = Object.keys(merchColumns.columns).length > 0;
    Object.assign(updatePayload, merchColumns.columns);

    // EPIC-039 Fase D — distribusi katalog toko online (channel 'web')
    const rawWebDistributed = (body as { web_distributed?: unknown }).web_distributed;
    const hasWebDistributedUpdate = rawWebDistributed !== undefined;

    if (!hasXpUpdate && !hasStationUpdate && !hasActiveUpdate && !hasAvailableUpdate && !hasMinXpUpdate && !hasBonusXpUpdate && !hasMerchUpdate && !hasWebDistributedUpdate && !hasSalesChannelsUpdate) {
      return NextResponse.json({ success: false, error: 'No product fields to update' }, { status: 400 });
    }

    if (hasWebDistributedUpdate) {
      await query(
        `INSERT INTO shop.product_channels (product_id, channel_code, is_distributed)
         VALUES ($1::uuid, 'web', $2)
         ON CONFLICT (product_id, channel_code)
         DO UPDATE SET is_distributed = EXCLUDED.is_distributed, updated_at = now()`,
        [id, Boolean(rawWebDistributed)]
      );
    }

    let { data, error } = await db
      .from('pos_products')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error?.code === '42703') {
      const legacyPayload = { ...updatePayload };
      if (hasXpUpdate) {
        legacyPayload.xp = xpPoints;
        delete legacyPayload.xp_points;
      }
      delete legacyPayload.station;

      const legacyRetry = await db
        .from('pos_products')
        .update(legacyPayload)
        .eq('id', id)
        .select('*')
        .single();

      data = legacyRetry.data;
      error = legacyRetry.error;
    }

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data ? withProductXpAlias(data as Record<string, unknown>) : null,
    });
  } catch (error: unknown) {
    console.error('Error updating POS product:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
