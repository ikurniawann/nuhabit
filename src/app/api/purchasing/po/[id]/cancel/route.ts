// ============================================
// API ROUTE: /api/purchasing/po/[id]/cancel
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { z } from "zod";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";

const cancelSchema = z.object({
  reason: z.string().min(1, "Alasan pembatalan wajib diisi"),
});

const CANCEL_ROLES = ["admin", "super_admin", "purchasing_admin", "purchasing_manager"] as const;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// POST /api/purchasing/po/:id/cancel
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();
    const body = await request.json();

    // Validasi input
    const { reason } = cancelSchema.parse(body);

    // Cek PO ada
    const { data: po, error: findError } = await db
      .from("purchase_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (findError || !po) {
      return Response.json(
        { success: false, message: "PO tidak ditemukan" },
        { status: 404 }
      );
    }

    // Validasi status - tidak bisa cancel jika sudah fully received
    if (po.status === "received") {
      return Response.json(
        { success: false, message: "PO yang sudah diterima sepenuhnya tidak bisa dibatalkan" },
        { status: 400 }
      );
    }

    if (po.status === "cancelled") {
      return Response.json(
        { success: false, message: "PO sudah dibatalkan sebelumnya" },
        { status: 400 }
      );
    }

    // Update status ke cancelled
    const { data, error } = await db
      .from("purchase_orders")
      .update({
        status: "cancelled",
        is_active: false,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    await recordAuditAfterCommit({
      actor: { id: user.id, name: user.full_name },
      action: "po.cancel",
      entity: "purchase_order",
      entityId: id,
      entityLabel: po.nomor_po ?? null,
      before: { status: po.status },
      after: { status: "cancelled" },
      reason,
      ...requestMeta(request),
    });

    // Release reserved stock jika ada
    // (Ini akan diimplementasikan saat inventory reservation)

    return Response.json({
      success: true,
      data,
      message: "PO berhasil dibatalkan",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error cancelling PO:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          message: "Validasi gagal",
          errors: error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal membatalkan PO") },
      { status: 500 }
    );
  }
}
