import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id } = await context.params;
    const checkoutId = String(id || "").trim();
    if (!checkoutId) {
      return NextResponse.json(
        { success: false, error: "Checkout tidak valid" },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const { data: checkout, error: checkoutErr } = await db
      .from("pos_checkouts")
      .select(
        "id, checkout_number, queue_number, table_id, payment_status, payment_method, customer_id, notes, total_amount, subtotal, xendit_qr_id, xendit_external_id"
      )
      .eq("id", checkoutId)
      .maybeSingle();

    if (checkoutErr) throw checkoutErr;
    if (!checkout) {
      return NextResponse.json(
        { success: false, error: "Checkout tidak ditemukan" },
        { status: 404 }
      );
    }

    const { data: orders, error: ordersErr } = await db
      .from("pos_orders")
      .select(
        "id, order_number, order_type, table_id, customer_id, notes, total_amount, payment_status, status, warehouse_id, items:pos_order_items(*)"
      )
      .eq("checkout_id", checkoutId)
      .neq("payment_status", "paid");

    if (ordersErr) throw ordersErr;

    const children = (orders || []) as Array<{
      id: string;
      order_type?: string | null;
      warehouse_id?: string | null;
      items?: Array<Record<string, unknown>> | null;
    }>;
    const items = children.flatMap((order) =>
      (order.items || []).map((item) => ({
        ...item,
        order_id: order.id,
        warehouse_id: order.warehouse_id,
      }))
    );

    return NextResponse.json({
      success: true,
      data: {
        ...checkout,
        order_type: children[0]?.order_type || "dine_in",
        order_ids: children.map((order) => order.id),
        items,
      },
    });
  } catch (error: unknown) {
    console.error("[pos] get checkout error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
