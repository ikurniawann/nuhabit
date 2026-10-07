import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { parsePositionPayload } from "@/lib/pos/tables/position-payload";

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

    const body = await request.json();
    const parsed = parsePositionPayload(body);
    if ("error" in parsed) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const { data, error } = await db
      .from("pos_tables")
      .update({
        pos_x: parsed.data.pos_x,
        pos_y: parsed.data.pos_y,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, pos_x, pos_y")
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
      message: "Table position saved",
      data: {
        id: (data as { id: string }).id,
        pos_x: Number((data as { pos_x: number }).pos_x),
        pos_y: Number((data as { pos_y: number }).pos_y),
      },
    });
  } catch (error) {
    console.error("POS table position error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to save position",
      },
      { status: 500 }
    );
  }
}
