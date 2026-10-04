import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { generateTableQrCode } from "@/lib/pos/tables/qr-code";

type TableRow = {
  id: string;
  table_number?: string | null;
  name?: string | null;
  floor?: string | null;
  area?: string | null;
  capacity?: number | string | null;
  status?: string | null;
  qr_code?: string | null;
  notes?: string | null;
  is_active?: boolean | null;
  pos_x?: number | string | null;
  pos_y?: number | string | null;
};

const TABLE_STATUSES = ["available", "occupied", "reserved", "maintenance"] as const;
const SELECT_COLS =
  "id, table_number, name, floor, area, capacity, status, qr_code, notes, is_active, pos_x, pos_y";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeTable(table: TableRow) {
  const tableNumber = String(table.table_number || "").trim()
    || String(table.qr_code || "").trim()
    || String(table.name || "").trim()
    || "Meja";
  return {
    id: table.id,
    table_number: tableNumber,
    name: table.name || tableNumber,
    label: table.name || tableNumber,
    floor: table.floor || null,
    area: table.area || null,
    capacity: toNumber(table.capacity) || 4,
    status: table.status || "available",
    qr_code: table.qr_code || null,
    notes: table.notes || null,
    is_active: table.is_active !== false,
    pos_x: table.pos_x == null ? null : Number(table.pos_x),
    pos_y: table.pos_y == null ? null : Number(table.pos_y),
  };
}

function parsePayload(body: Record<string, unknown>) {
  const table_number = String(body.table_number ?? "").trim();
  const name = body.name != null ? String(body.name).trim() || null : null;
  const floor = body.floor != null ? String(body.floor).trim() || null : null;
  const area = body.area != null ? String(body.area).trim() || null : null;
  let qr_code = body.qr_code != null ? String(body.qr_code).trim() || null : null;
  const notes = body.notes != null ? String(body.notes).trim() || null : null;
  const capacity = Math.max(1, Math.floor(toNumber(body.capacity) || 4));
  const is_active = body.is_active !== false;
  const statusRaw = String(body.status ?? "available");
  const status = TABLE_STATUSES.includes(statusRaw as (typeof TABLE_STATUSES)[number])
    ? statusRaw
    : "available";

  if (!table_number) {
    return { error: "Table number is required" as const };
  }

  if (!qr_code) {
    qr_code = generateTableQrCode(table_number);
  }

  return {
    data: {
      table_number,
      name,
      floor,
      area,
      qr_code,
      notes,
      capacity,
      is_active,
      status,
    },
  };
}

export async function PATCH(
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
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Table ID is required" },
        { status: 400 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parsePayload(body);
    if ("error" in parsed) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }

    const db = createPgClient();

    // Don't force occupied via master form if there is no open bill —
    // keep reserved/maintenance/available as set by admin.
    const { data, error } = await db
      .from("pos_tables")
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(SELECT_COLS)
      .maybeSingle();

    if (error) {
      if (/unique|duplicate/i.test(error.message)) {
        return NextResponse.json(
          {
            success: false,
            error: "Table number or QR code already exists",
          },
          { status: 409 }
        );
      }
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Table not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Table updated",
      data: normalizeTable(data as TableRow),
    });
  } catch (error) {
    console.error("POS tables update error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update table",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Table ID is required" },
        { status: 400 }
      );
    }

    const db = createPgClient();

    const { data: activeOrders, error: orderError } = await db
      .from("pos_orders")
      .select("id")
      .eq("table_id", id)
      .in("status", ["pending", "confirmed", "preparing", "ready", "served"])
      .limit(1);

    if (orderError) throw orderError;
    if (activeOrders && activeOrders.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Table still has an open bill — deactivate instead of deleting",
        },
        { status: 409 }
      );
    }

    // Soft-delete by default to preserve history / FK references.
    const { data, error } = await db
      .from("pos_tables")
      .update({
        is_active: false,
        status: "maintenance",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { success: false, error: "Table not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Table deactivated",
    });
  } catch (error) {
    console.error("POS tables delete error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete table",
      },
      { status: 500 }
    );
  }
}
