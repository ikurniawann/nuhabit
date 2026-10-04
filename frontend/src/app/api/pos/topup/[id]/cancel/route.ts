import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

// POST /api/pos/topup/[id]/cancel — cancel a pending QRIS top-up
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const db = createPgClient();

    const { data: tx, error } = await db
      .from("pos_wallet_transactions")
      .select("id, status, type, payment_method, metadata")
      .eq("id", id)
      .eq("type", "topup")
      .maybeSingle();

    if (error) throw error;
    if (!tx) {
      return NextResponse.json({ success: false, error: "Top-up not found" }, { status: 404 });
    }

    const status = String((tx as { status?: string }).status || "completed");
    if (status !== "pending") {
      return NextResponse.json(
        { success: false, error: "Only pending top-ups can be cancelled" },
        { status: 400 }
      );
    }

    const metadata = {
      ...(((tx as { metadata?: Record<string, unknown> }).metadata as Record<string, unknown>) ||
        {}),
      cancelled_at: new Date().toISOString(),
      cancelled_by: sessionUserId,
    };

    const { data: updated, error: updateError } = await db
      .from("pos_wallet_transactions")
      .update({
        status: "cancelled",
        notes: "Top-up cancelled",
        metadata,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Top-up was already updated" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        topup_id: id,
        status: "cancelled",
        transaction: updated,
      },
    });
  } catch (error: unknown) {
    console.error("Error cancelling topup:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
