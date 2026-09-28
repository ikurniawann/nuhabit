import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction, requireIamMenuPrefix } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { MAX_CHANNEL_PRICE } from "@/lib/pos/channel-pricing";
import {
  loadChannelOverrides,
  loadChannelProducts,
  loadChannelRule,
  loadSalesChannels,
} from "@/lib/pos/channel-pricing-server";

/**
 * Harga per channel (POS → Katalog → Harga Channel).
 * - GET ?channel=gofood : semua channel + aturan + produk beserta harga manualnya.
 *   Harga otomatis dihitung di klien dgn fungsi yang sama (pratinjau aturan).
 * - PUT { channel, prices: [{ product_id, price|null }] } : simpan/hapus harga
 *   manual (null = kembali ke harga otomatis). { channel, reset_all: true }
 *   menghapus semua harga manual channel itu.
 */
export const dynamic = "force-dynamic";

const MENU = ["pos.catalog.channel-prices"] as const;

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function handleError(error: unknown, label: string) {
  if (error instanceof ApiError) return error.toResponse();
  console.error(`[pos/channel-prices] ${label} gagal:`, error);
  return fail("Gagal memproses harga channel", 500);
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(MENU);
    const channels = await loadSalesChannels();
    const requested = request.nextUrl.searchParams.get("channel");
    const channel = channels.find((item) => item.code === requested) ?? channels[0] ?? null;
    if (!channel) return NextResponse.json({ success: true, data: { channels, channel: null, products: [] } });

    const [products, overrides] = await Promise.all([loadChannelProducts(), loadChannelOverrides(channel.code)]);
    return NextResponse.json({
      success: true,
      data: {
        channels,
        channel,
        products: products.map((product) => ({
          ...product,
          base_price: Number(product.base_price) || 0,
          override_price: overrides.get(product.id) ?? null,
        })),
      },
    });
  } catch (error) {
    return handleError(error, "GET");
  }
}

const putSchema = z.union([
  z.object({
    channel: z.string().trim().min(1).max(32),
    reset_all: z.literal(true),
  }),
  z.object({
    channel: z.string().trim().min(1).max(32),
    prices: z
      .array(
        z.object({
          product_id: z.string().uuid(),
          price: z.number().int().positive().max(MAX_CHANNEL_PRICE).nullable(),
        })
      )
      .min(1)
      .max(1000),
  }),
]);

export async function PUT(request: NextRequest) {
  try {
    const user = await requireIamAction(MENU, "update");
    const parsed = putSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Data harga tidak valid (harga harus bilangan bulat > 0)", 400);
    const payload = parsed.data;
    if (!(await loadChannelRule(payload.channel))) return fail("Channel tidak dikenal", 404);

    const result = await withTransaction(async (client) => {
      if ("reset_all" in payload) {
        const removed = await client.query(
          "DELETE FROM pos.pos_product_channel_prices WHERE channel_code = $1",
          [payload.channel]
        );
        return { saved: 0, cleared: removed.rowCount ?? 0 };
      }

      const clear = payload.prices.filter((item) => item.price === null).map((item) => item.product_id);
      const upsert = payload.prices.filter((item): item is { product_id: string; price: number } => item.price !== null);
      let cleared = 0;
      if (clear.length > 0) {
        const removed = await client.query(
          "DELETE FROM pos.pos_product_channel_prices WHERE channel_code = $1 AND product_id = ANY($2::uuid[])",
          [payload.channel, clear]
        );
        cleared = removed.rowCount ?? 0;
      }
      let saved = 0;
      if (upsert.length > 0) {
        // Hanya produk yang benar-benar ada; id asing diabaikan (tidak error FK).
        const written = await client.query(
          `INSERT INTO pos.pos_product_channel_prices (product_id, channel_code, price, updated_by)
           SELECT p.id, $1, v.price, $4
           FROM unnest($2::uuid[], $3::numeric[]) AS v(product_id, price)
           JOIN pos.pos_products p ON p.id = v.product_id
           ON CONFLICT (product_id, channel_code)
           DO UPDATE SET price = EXCLUDED.price, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [payload.channel, upsert.map((item) => item.product_id), upsert.map((item) => item.price), user.id]
        );
        saved = written.rowCount ?? 0;
      }
      return { saved, cleared };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleError(error, "PUT");
  }
}
