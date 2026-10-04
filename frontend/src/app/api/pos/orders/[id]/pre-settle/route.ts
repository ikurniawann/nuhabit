import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";

const ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
] as const;

/** POST /api/pos/orders/:id/pre-settle — mark bill ready for payment (red on denah). */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const { id: orderId } = await params;
  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "Order ID required" },
      { status: 400 }
    );
  }

  try {
    const db = createPgClient();
    const now = new Date().toISOString();

    const { data: order, error: fetchError } = await db
      .from("pos_orders")
      .select("id, status, payment_status, table_id")
      .eq("id", orderId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    if (!ACTIVE_STATUSES.includes(order.status as (typeof ACTIVE_STATUSES)[number])) {
      return NextResponse.json(
        { success: false, error: "Order is not active" },
        { status: 409 }
      );
    }

    if (order.payment_status === "paid") {
      return NextResponse.json(
        { success: false, error: "Order is already paid" },
        { status: 409 }
      );
    }

    const { data, error } = await db
      .from("pos_orders")
      .update({ pre_settled_at: now, updated_at: now })
      .eq("id", orderId)
      .select("id, order_number, table_id, pre_settled_at, payment_status, status")
      .single();

    if (error) {
      if (error.code === "42703" || error.code === "PGRST204") {
        return NextResponse.json(
          {
            success: false,
            error:
              "pre_settled_at column missing — run db:migrate for 20260712160000_pos_orders_pre_settled_at",
          },
          { status: 500 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      data,
      message: "Pre settlement marked",
    });
  } catch (error) {
    console.error("[pre-settle] failed:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to mark pre settlement",
      },
      { status: 500 }
    );
  }
}
