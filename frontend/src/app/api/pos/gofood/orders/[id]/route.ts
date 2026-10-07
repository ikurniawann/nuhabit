import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosMenu } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { GobizApiError } from "@/lib/gobiz/client";
import {
  acceptGofoodOrderById,
  ensurePosOrderForGofood,
  getGofoodOrder,
  GobizNotConfiguredError,
  markGofoodOrderReadyById,
  rejectGofoodOrderById,
} from "@/lib/gobiz/service";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("reject"),
    reason_code: z.enum(["HIGH_DEMAND", "RESTAURANT_CLOSED", "ITEMS_OUT_OF_STOCK", "OTHERS"]),
    reason_description: z.string().trim().min(3).max(200),
  }),
  z.object({ action: z.literal("ready") }),
  /** Buat ulang order POS bila sebelumnya gagal (mis. item belum terpetakan lalu katalog disinkron). */
  z.object({ action: z.literal("create_pos_order") }),
]);

/** POST /api/pos/gofood/orders/[id] {action: accept|reject|ready|create_pos_order} */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const pos = await requirePosMenu(IAM.posOperations);
  if (pos.error) return pos.error;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Aksi tidak valid" }, { status: 400 });

  try {
    switch (parsed.data.action) {
      case "accept":
        return NextResponse.json({ success: true, data: await acceptGofoodOrderById(id) });
      case "reject":
        return NextResponse.json({
          success: true,
          data: await rejectGofoodOrderById(id, {
            code: parsed.data.reason_code,
            description: parsed.data.reason_description,
          }),
        });
      case "ready":
        return NextResponse.json({ success: true, data: await markGofoodOrderReadyById(id) });
      case "create_pos_order": {
        const row = await getGofoodOrder(id);
        if (!row) return NextResponse.json({ success: false, error: "Order tidak ditemukan" }, { status: 404 });
        const posOrderId = await ensurePosOrderForGofood(row);
        return NextResponse.json({ success: true, data: { ...(await getGofoodOrder(id)), pos_order_id: posOrderId } });
      }
    }
  } catch (error) {
    if (error instanceof GobizNotConfiguredError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof GobizApiError) {
      return NextResponse.json({ success: false, error: `GoBiz: ${error.message}`, detail: error.body }, { status: 502 });
    }
    console.error("[pos/gofood] action failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Aksi gagal" },
      { status: 400 }
    );
  }
}
