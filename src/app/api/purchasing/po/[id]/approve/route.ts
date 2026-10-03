// ============================================
// API ROUTE: /api/purchasing/po/[id]/approve
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamAction, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";

const APPROVE_ROLES = ["admin", "super_admin", "purchasing_admin", "purchasing_manager"] as const;

// POST /api/purchasing/po/:id/approve
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamAction(IAM.itemsApproval, "update");
    const { id } = await params;
    const db = await createServerPgClient();

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

    // Validasi status
    if (po.status !== "draft") {
      return Response.json(
        { success: false, message: "PO hanya bisa diapprove saat status draft" },
        { status: 400 }
      );
    }

    // Cek apakah PO punya items
    const { data: items } = await db
      .from("purchase_order_items")
      .select("id")
      .eq("purchase_order_id", id)
      .eq("is_active", true);

    if (!items || items.length === 0) {
      return Response.json(
        { success: false, message: "PO tidak memiliki item. Tambahkan item terlebih dahulu." },
        { status: 400 }
      );
    }

    // Update status ke approved
    const { data, error } = await db
      .from("purchase_orders")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    await recordAuditAfterCommit({
      actor: { id: user.id, name: user.full_name },
      action: "po.approve",
      entity: "purchase_order",
      entityId: id,
      entityLabel: po.nomor_po ?? null,
      before: { status: po.status },
      after: { status: "approved", grand_total: po.grand_total ?? null },
      ...requestMeta(request),
    });

    return Response.json({
      success: true,
      data,
      message: "PO berhasil diapprove",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error approving PO:", error);
    return Response.json(
      { success: false, message: "Gagal mengapprove PO" },
      { status: 500 }
    );
  }
}
