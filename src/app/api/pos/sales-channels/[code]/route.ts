import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { MAX_MARKUP_PERCENT, ROUNDING_MODES, ROUNDING_STEPS } from "@/lib/pos/channel-pricing";
import { loadChannelRule } from "@/lib/pos/channel-pricing-server";

/**
 * PUT /api/pos/sales-channels/[code] — aturan harga channel: markup %,
 * pembulatan, aktif. Berlaku untuk semua produk tanpa harga manual serta
 * semua varian & add-on; ke GoFood baru terkirim saat katalog disinkron.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  markup_percent: z.number().min(0).max(MAX_MARKUP_PERCENT),
  rounding_step: z.number().refine((value) => (ROUNDING_STEPS as number[]).includes(value), "Pembulatan tidak valid"),
  rounding_mode: z.enum(ROUNDING_MODES as [string, ...string[]]),
  is_active: z.boolean(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await requireIamAction(["pos.catalog.channel-prices"], "update");
    const { code } = await params;
    if (!(await loadChannelRule(code))) {
      return NextResponse.json({ success: false, error: "Channel tidak dikenal" }, { status: 404 });
    }
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Aturan harga tidak valid" }, { status: 400 });
    }
    const body = parsed.data;
    await query(
      `UPDATE pos.sales_channels
       SET markup_percent = $2, rounding_step = $3, rounding_mode = $4, is_active = $5,
           updated_by = $6, updated_at = now()
       WHERE code = $1`,
      [code, Math.round(body.markup_percent * 100) / 100, body.rounding_step, body.rounding_mode, body.is_active, user.id]
    );
    return NextResponse.json({ success: true, data: await loadChannelRule(code) });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[pos/sales-channels] PUT gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan aturan harga" }, { status: 500 });
  }
}
