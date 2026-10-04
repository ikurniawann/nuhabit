import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { normalizeGuestCount } from "@/lib/pos/guest-count";

const ACTIVE_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Seat failed";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id: reservationId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      table_id?: string | null;
    };
    const db = createPgClient();

    const { data: reservation, error: reservationErr } = await db
      .from("pos_reservations")
      .select(
        "id, status, table_id, customer_id, customer_name, customer_phone, time_slot, pax_count, notes"
      )
      .eq("id", reservationId)
      .single();

    if (reservationErr || !reservation) {
      return NextResponse.json(
        { success: false, error: "Reservation not found" },
        { status: 404 }
      );
    }

    const status = String(reservation.status || "").toLowerCase();
    if (status !== "pending" && status !== "confirmed") {
      return NextResponse.json(
        {
          success: false,
          error: "Only pending or confirmed reservations can be seated",
        },
        { status: 400 }
      );
    }

    const tableId = String(body.table_id || reservation.table_id || "").trim();
    if (!tableId) {
      return NextResponse.json(
        { success: false, error: "table_id is required" },
        { status: 400 }
      );
    }

    const { data: table, error: tableErr } = await db
      .from("pos_tables")
      .select("id, status, is_active, table_number, name")
      .eq("id", tableId)
      .single();

    if (tableErr || !table) {
      return NextResponse.json(
        { success: false, error: "Table not found" },
        { status: 404 }
      );
    }

    if (table.is_active === false) {
      return NextResponse.json(
        { success: false, error: "Table is inactive" },
        { status: 400 }
      );
    }

    const { data: occupiedOrder } = await db
      .from("pos_orders")
      .select("id")
      .eq("table_id", tableId)
      .in("status", ACTIVE_ORDER_STATUSES)
      .limit(1)
      .maybeSingle();

    if (occupiedOrder) {
      return NextResponse.json(
        { success: false, error: "Table is occupied" },
        { status: 409 }
      );
    }

    const guestName =
      String(reservation.customer_name || "").trim() || "Guest";
    const timeSlot = String(reservation.time_slot || "").trim();
    const notes = `Reservation · ${guestName}${timeSlot ? ` · ${timeSlot}` : ""}`;

    const { data: orderNumData, error: orderNumErr } = await db.rpc(
      "generate_order_number"
    );
    if (orderNumErr) {
      return NextResponse.json(
        { success: false, error: "Failed to generate order number" },
        { status: 500 }
      );
    }
    const orderNumber =
      typeof orderNumData === "string"
        ? orderNumData
        : String(orderNumData);

    const { data: order, error: orderErr } = await db
      .from("pos_orders")
      .insert({
        order_number: orderNumber,
        order_type: "dine_in",
        status: "pending",
        payment_status: "unpaid",
        customer_id: reservation.customer_id || null,
        cashier_id: sessionUserId,
        table_id: tableId,
        // Reservasi sudah menyimpan jumlah tamu di `pax_count` — dibawa langsung
        // ke pesanan (EPIC-038) supaya pramusaji tidak mengetik ulang angka yang
        // sudah diketahui sistem. Kalau kosong, normalizeGuestCount → 1.
        guest_count: normalizeGuestCount(reservation.pax_count),
        subtotal: 0,
        discount_amount: 0,
        tax_amount: 0,
        service_charge_amount: 0,
        total_amount: 0,
        payment_method: null,
        amount_paid: 0,
        ark_coins_used: 0,
        notes,
        special_requests: null,
        ordered_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderErr || !order) {
      return NextResponse.json(
        {
          success: false,
          error: orderErr?.message || "Failed to create open bill",
        },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();
    const { data: updatedReservation, error: seatErr } = await db
      .from("pos_reservations")
      .update({
        status: "seated",
        table_id: tableId,
        updated_at: now,
      })
      .eq("id", reservationId)
      .select()
      .single();

    if (seatErr) throw seatErr;

    await db
      .from("pos_tables")
      .update({
        status: "occupied",
        updated_at: now,
      })
      .eq("id", tableId);

    return NextResponse.json({
      success: true,
      data: {
        reservation: updatedReservation,
        order,
        message: "Guest seated",
      },
    });
  } catch (error: unknown) {
    console.error("Seat reservation error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
