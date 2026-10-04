import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";

function formatPgDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const raw = String(value).trim();
  // Plain date column text
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // ISO / timestamp — use local calendar day (DATE midnight in TZ)
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return raw;
}

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
  return "Unknown error";
}

function normalizeTimeSlot(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Accept HH:MM or HH:MM:SS → store as HH:MM:SS for time columns
  if (/^\d{1,2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return raw;
}

// GET /api/pos/reservations - List reservations with filters
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get("date");
    const status = searchParams.get("status");
    const tableId = searchParams.get("table_id");

    let query = db
      .from("pos_reservations")
      .select("*")
      .order("reservation_date", { ascending: true })
      .order("time_slot", { ascending: true });

    if (date) {
      query = query.eq("reservation_date", date);
    }

    // Ignore bogus "undefined" from clients that stringify missing params
    if (status && status !== "undefined" && status !== "all") {
      query = query.eq("status", status);
    }

    if (tableId && tableId !== "undefined") {
      query = query.eq("table_id", tableId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const enriched = await Promise.all(
      rows.map(async (row: Record<string, unknown>) => {
        let table: { table_number?: string | null } | null = null;
        let customer: { name?: string | null; phone?: string | null } | null =
          null;

        if (row.table_id) {
          const { data: tableRow } = await db
            .from("pos_tables")
            .select("table_number")
            .eq("id", row.table_id)
            .maybeSingle();
          table = tableRow;
        }

        if (row.customer_id) {
          const { data: customerRow } = await db
            .from("pos_customers")
            .select("name, phone")
            .eq("id", row.customer_id)
            .maybeSingle();
          customer = customerRow;
        }

        const normalizedDate = formatPgDate(row.reservation_date);

        return {
          ...row,
          reservation_date: normalizedDate,
          table,
          customer,
        };
      })
    );

    return NextResponse.json({ success: true, data: enriched });
  } catch (error: unknown) {
    console.error("Error fetching reservations:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/pos/reservations - Create new reservation
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const db = createPgClient();
    const body = await request.json();
    const {
      table_id,
      customer_id,
      customer_name,
      customer_phone,
      reservation_date,
      time_slot,
      duration_minutes = 120,
      pax_count,
      special_requests,
      deposit_amount = 0,
      notes,
    } = body;

    const normalizedTime = normalizeTimeSlot(time_slot);

    if (!reservation_date || !normalizedTime || !pax_count) {
      return NextResponse.json(
        {
          success: false,
          error: "Date, time slot, and party size are required",
        },
        { status: 400 }
      );
    }

    if (!String(customer_name || "").trim()) {
      return NextResponse.json(
        { success: false, error: "Customer name is required" },
        { status: 400 }
      );
    }

    if (table_id) {
      const { data: conflictingReservation } = await db
        .from("pos_reservations")
        .select("id")
        .eq("table_id", table_id)
        .eq("reservation_date", reservation_date)
        .eq("time_slot", normalizedTime)
        .neq("status", "cancelled")
        .maybeSingle();

      if (conflictingReservation) {
        return NextResponse.json(
          {
            success: false,
            error: "Table is already reserved for this time slot",
          },
          { status: 409 }
        );
      }
    }

    // Insert without PostgREST embeds — QueryBuilder RETURNING cannot expand embeds.
    const { data: reservation, error: reservationError } = await db
      .from("pos_reservations")
      .insert({
        table_id: table_id || null,
        customer_id: customer_id || null,
        customer_name: String(customer_name).trim(),
        customer_phone: customer_phone
          ? String(customer_phone).trim()
          : null,
        reservation_date,
        time_slot: normalizedTime,
        duration_minutes,
        pax_count: Number(pax_count),
        special_requests: special_requests || null,
        deposit_amount: Number(deposit_amount) || 0,
        status: "pending",
        notes: notes || null,
      })
      .select("*")
      .single();

    if (reservationError) throw reservationError;

    // Nomor antrian per tanggal (W-xx) — advisory lock per tanggal supaya dua
    // pendaftaran bersamaan tidak mendapat nomor sama; unique index pagar akhir.
    let queueNumber: number | null = null;
    try {
      queueNumber = await withTransaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('pos-res-queue-' || $1::date::text))",
          [reservation_date]
        );
        const { rows } = await client.query<{ queue_number: number }>(
          `UPDATE pos.pos_reservations r
              SET queue_number = sub.next_number
             FROM (
               SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_number
                 FROM pos.pos_reservations
                WHERE reservation_date::date = $2::date
                  AND id <> $1
             ) sub
            WHERE r.id = $1
            RETURNING r.queue_number`,
          [reservation.id, reservation_date]
        );
        return rows[0]?.queue_number ?? null;
      });
    } catch (queueErr) {
      // Nomor antrian gagal ≠ reservasi gagal — baris tetap tersimpan.
      console.error("[pos] reservation queue number error:", queueErr);
    }
    if (reservation && queueNumber != null) reservation.queue_number = queueNumber;

    let table: { table_number?: string | null } | null = null;
    let customer: { name?: string | null; phone?: string | null } | null =
      null;

    if (reservation?.table_id) {
      const { data: tableRow } = await db
        .from("pos_tables")
        .select("table_number")
        .eq("id", reservation.table_id)
        .maybeSingle();
      table = tableRow;
    }

    if (reservation?.customer_id) {
      const { data: customerRow } = await db
        .from("pos_customers")
        .select("name, phone")
        .eq("id", reservation.customer_id)
        .maybeSingle();
      customer = customerRow;
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          ...reservation,
          table,
          customer,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating reservation:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
