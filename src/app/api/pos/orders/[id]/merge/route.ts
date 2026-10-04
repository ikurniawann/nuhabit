import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import {
  approveOrderWithSupervisorPin,
  isOrderInUserScope,
  supervisorPinLockedMessage,
  type OrderScopeRow,
} from "@/lib/pos/supervisor-pin-server";
import { getPosSession } from "@/lib/api/auth";
import { canAppendTransferItems } from "@/lib/pos/table-sale-target";
import {
  billBlocksItemMoves,
  logOrderItemMove,
  type BillPaymentSnapshot,
} from "@/lib/pos/bill-item-moves";

function errorMessage(error: unknown, fallback = "Merge failed") {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

async function orderHasUnpaidSplits(
  db: ReturnType<typeof createPgClient>,
  orderId: string
) {
  const { data, error } = await db
    .from("pos_order_splits")
    .select("id, status")
    .eq("order_id", orderId)
    .neq("status", "cancelled");

  if (error) throw error;
  return (data || []).some(
    (split) => String(split.status || "").toLowerCase() !== "paid"
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return Response.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { target_order_id, supervisor_pin } = body as {
      target_order_id?: string;
      supervisor_pin?: string;
    };
    const { id: sourceOrderId } = await params;

    if (!target_order_id) {
      return Response.json(
        { success: false, error: "Target order required" },
        { status: 400 }
      );
    }

    if (sourceOrderId === target_order_id) {
      return Response.json(
        { success: false, error: "Cannot merge order with itself" },
        { status: 400 }
      );
    }

    const db = createPgClient();

    const columns =
      "id, order_number, status, payment_status, amount_paid, table_id, discount_amount, tax_amount, checkout_id, sold_from, company_id, branch_id";
    const [{ data: sourceRow }, { data: targetRow }] = await Promise.all([
      db.from("pos_orders").select(columns).eq("id", sourceOrderId).maybeSingle(),
      db.from("pos_orders").select(columns).eq("id", target_order_id).maybeSingle(),
    ]);
    // Order di luar scope bisnis kasir diperlakukan sama dengan tidak ada.
    const scoped = async (row: typeof sourceRow) =>
      row && (await isOrderInUserScope(sessionUserId, row as OrderScopeRow)) ? row : null;
    const [source, target] = await Promise.all([scoped(sourceRow), scoped(targetRow)]);

    // PIN opsional (UI merge tidak memintanya). Bila dikirim, PIN dicek
    // terhadap supervisor yang mencakup order sumber, dengan batas percobaan;
    // order hilang dijawab sama dengan PIN salah.
    if (supervisor_pin != null && String(supervisor_pin).trim() !== "") {
      const approval = await approveOrderWithSupervisorPin({
        callerId: sessionUserId,
        orderId: sourceOrderId,
        order: source && target ? (source as OrderScopeRow) : null,
        pin: String(supervisor_pin),
      });
      if (!approval.ok) {
        return approval.reason === "locked"
          ? Response.json({ success: false, error: supervisorPinLockedMessage(approval.retryMinutes) }, { status: 429 })
          : Response.json({ success: false, error: "Invalid supervisor PIN" }, { status: 403 });
      }
    }

    if (!source || !target) {
      return Response.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    const blockedStatuses = ["completed", "cancelled", "voided", "merged"];
    if (blockedStatuses.includes(source.status as string)) {
      return Response.json(
        { success: false, error: "Source order cannot be merged" },
        { status: 400 }
      );
    }
    if (blockedStatuses.includes(target.status as string)) {
      return Response.json(
        { success: false, error: "Target order cannot receive merge" },
        { status: 400 }
      );
    }

    // Insiden 2026-08-23: bill yang sudah dibayar tidak boleh di-merge — total
    // target dihitung ulang tanpa menyentuh amount_paid, data tak lagi cocok
    // dengan struk. Begitu ada uang masuk, isi bill terkunci.
    const sourceBlocked = billBlocksItemMoves(source as BillPaymentSnapshot);
    if (sourceBlocked) {
      return Response.json(
        {
          success: false,
          error: `Bill ${(source as { order_number?: string }).order_number || ""} ${sourceBlocked} — tidak bisa digabung`,
        },
        { status: 400 }
      );
    }
    const targetBlocked = billBlocksItemMoves(target as BillPaymentSnapshot);
    if (targetBlocked) {
      return Response.json(
        {
          success: false,
          error: `Bill tujuan ${(target as { order_number?: string }).order_number || ""} ${targetBlocked} — tidak bisa menerima gabungan`,
        },
        { status: 400 }
      );
    }

    const sourceBill = {
      checkout_id: (source as { checkout_id?: string | null }).checkout_id ?? null,
      sold_from: (source as { sold_from?: string | null }).sold_from ?? null,
    };
    const targetBill = {
      checkout_id: (target as { checkout_id?: string | null }).checkout_id ?? null,
      sold_from: (target as { sold_from?: string | null }).sold_from ?? null,
    };
    if (!canAppendTransferItems(sourceBill, targetBill)) {
      return Response.json(
        {
          success: false,
          error: "Tidak bisa merge tagihan stall ke kasir pusat",
        },
        { status: 400 }
      );
    }

    if (await orderHasUnpaidSplits(db, sourceOrderId)) {
      return Response.json(
        {
          success: false,
          error: "Finish or cancel unpaid splits before merging",
        },
        { status: 400 }
      );
    }
    if (await orderHasUnpaidSplits(db, target_order_id)) {
      return Response.json(
        {
          success: false,
          error: "Target bill has unpaid splits",
        },
        { status: 400 }
      );
    }

    // Snapshot item SEBELUM dipindah — bahan audit trail.
    const { data: sourceItemRows } = await db
      .from("pos_order_items")
      .select("id, product_name, quantity, unit_price, total_amount")
      .eq("order_id", sourceOrderId);

    const { error: moveErr } = await db
      .from("pos_order_items")
      .update({ order_id: target_order_id })
      .eq("order_id", sourceOrderId);

    if (moveErr) throw moveErr;

    const { data: itemsAgg, error: aggErr } = await db
      .from("pos_order_items")
      .select("subtotal, total_amount")
      .eq("order_id", target_order_id);

    if (aggErr) throw aggErr;

    const newSubtotal = (itemsAgg || []).reduce(
      (s, it) => s + Number(it.subtotal || 0),
      0
    );
    const newTotal = (itemsAgg || []).reduce(
      (s, it) => s + Number(it.total_amount || 0),
      0
    );

    const { error: updTargetErr } = await db
      .from("pos_orders")
      .update({
        subtotal: newSubtotal,
        total_amount: newTotal,
        discount_amount:
          Number(target.discount_amount || 0) +
          Number(source.discount_amount || 0),
        tax_amount:
          Number(target.tax_amount || 0) + Number(source.tax_amount || 0),
        updated_at: new Date().toISOString(),
      })
      .eq("id", target_order_id);

    if (updTargetErr) throw updTargetErr;

    // UUID[] must use array_append — QueryBuilder JS arrays often fail to cast.
    await getPool().query(
      `UPDATE pos_orders
       SET merged_from_orders = array_append(COALESCE(merged_from_orders, '{}'), $1::uuid),
           updated_at = NOW()
       WHERE id = $2`,
      [sourceOrderId, target_order_id]
    );

    const { error: updSourceErr } = await db
      .from("pos_orders")
      .update({
        status: "merged",
        merged_to_order_id: target_order_id,
        payment_status: "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceOrderId);

    if (updSourceErr) throw updSourceErr;

    if (source.table_id) {
      const { data: otherActive } = await db
        .from("pos_orders")
        .select("id")
        .eq("table_id", source.table_id)
        .in("status", [
          "pending",
          "confirmed",
          "preparing",
          "ready",
          "served",
        ])
        .neq("id", sourceOrderId)
        .limit(1)
        .maybeSingle();

      if (!otherActive) {
        await db
          .from("pos_tables")
          .update({
            status: "available",
            updated_at: new Date().toISOString(),
          })
          .eq("id", source.table_id);
      }
    }

    // Audit trail (insiden 2026-08-23): siapa menggabung bill apa ke mana,
    // item apa saja yang ikut pindah. Gagal log tidak membatalkan merge.
    await logOrderItemMove({
      action: "merge",
      sourceOrderId,
      sourceOrderNumber: (source as { order_number?: string | null }).order_number ?? null,
      targetOrderId: target_order_id,
      targetOrderNumber: (target as { order_number?: string | null }).order_number ?? null,
      items: (sourceItemRows || []) as Array<{
        id: string;
        product_name: string | null;
        quantity: number;
        unit_price: number;
        total_amount: number;
      }>,
      movedBy: sessionUserId,
    });

    return Response.json({
      success: true,
      data: {
        source_order_id: sourceOrderId,
        target_order_id: target_order_id,
        message: "Orders merged successfully",
      },
    });
  } catch (error: unknown) {
    console.error("Merge error:", error);
    return Response.json(
      {
        success: false,
        error: errorMessage(error, "Merge failed"),
      },
      { status: 500 }
    );
  }
}
