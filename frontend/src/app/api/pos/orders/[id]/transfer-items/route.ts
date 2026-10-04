import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { allocateQueueNumber } from "@/lib/pos/queue-number";
import { canAppendTransferItems } from "@/lib/pos/table-sale-target";
import {
  billBlocksItemMoves,
  logOrderItemMove,
  type BillPaymentSnapshot,
} from "@/lib/pos/bill-item-moves";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready", "served"];

type TransferItemInput = {
  order_item_id?: string;
  qty?: number;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  variants: unknown;
  modifiers: unknown;
  quantity: number;
  unit_price: number;
  subtotal: number;
  total_amount: number;
  station?: string | null;
  kitchen_status?: string | null;
  kitchen_notes?: string | null;
  cost_price?: number | null;
  cost_total?: number | null;
  gross_profit?: number | null;
  gross_margin_pct?: number | null;
};

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
  const unpaid = ((data || []) as Array<{ status?: string | null }>).filter(
    (split) => String(split.status || "").toLowerCase() !== "paid"
  );
  return unpaid.length > 0;
}

async function recalculateOrderTotals(
  db: ReturnType<typeof createPgClient>,
  orderId: string
) {
  const { data: items, error } = await db
    .from("pos_order_items")
    .select("subtotal, total_amount")
    .eq("order_id", orderId);

  if (error) throw error;

  const newSubtotal = ((items || []) as Array<{ subtotal?: unknown; total_amount?: unknown }>).reduce(
    (sum, item) => sum + Number(item.subtotal || 0),
    0
  );
  const newTotal = ((items || []) as Array<{ subtotal?: unknown; total_amount?: unknown }>).reduce(
    (sum, item) => sum + Number(item.total_amount || 0),
    0
  );

  const { data: order, error: orderErr } = await db
    .from("pos_orders")
    .select("id, discount_amount, tax_amount, service_charge_amount")
    .eq("id", orderId)
    .single();

  if (orderErr) throw orderErr;

  // Keep existing tax/discount unless items emptied — then zero them.
  const empty = (items || []).length === 0;
  const { error: updErr } = await db
    .from("pos_orders")
    .update({
      subtotal: newSubtotal,
      total_amount: empty
        ? 0
        : newTotal ||
          newSubtotal +
            Number(order?.tax_amount || 0) +
            Number(order?.service_charge_amount || 0) -
            Number(order?.discount_amount || 0),
      discount_amount: empty ? 0 : order?.discount_amount || 0,
      tax_amount: empty ? 0 : order?.tax_amount || 0,
      service_charge_amount: empty ? 0 : order?.service_charge_amount || 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updErr) throw updErr;

  return { itemCount: (items || []).length, subtotal: newSubtotal, total: newTotal };
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
    const { target_table_id, items } = body as {
      target_table_id?: string;
      items?: TransferItemInput[];
    };
    const { id: sourceOrderId } = await params;

    if (!target_table_id) {
      return Response.json(
        { success: false, error: "target_table_id is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json(
        { success: false, error: "items are required" },
        { status: 400 }
      );
    }

    const db = createPgClient();

    const { data: source, error: sourceErr } = await db
      .from("pos_orders")
      .select("id, order_number, status, payment_status, amount_paid, table_id, discount_amount, tax_amount, company_id, branch_id, checkout_id, sold_from")
      .eq("id", sourceOrderId)
      .single();

    if (sourceErr || !source) {
      return Response.json(
        { success: false, error: "Source order not found" },
        { status: 404 }
      );
    }

    if (!ACTIVE_STATUSES.includes(String(source.status))) {
      return Response.json(
        { success: false, error: "Source order cannot transfer items" },
        { status: 400 }
      );
    }

    // Insiden 2026-08-23: bill sudah dibayar tapi itemnya masih bisa dipindah
    // → total dihitung ulang, amount_paid tidak, data tak lagi cocok dengan
    // struk. Begitu ada uang masuk, isi bill terkunci.
    const sourceBlocked = billBlocksItemMoves(source as BillPaymentSnapshot);
    if (sourceBlocked) {
      return Response.json(
        {
          success: false,
          error: `Bill ${(source as { order_number?: string }).order_number || ""} ${sourceBlocked} — item tidak bisa dipindah`,
        },
        { status: 400 }
      );
    }

    if (await orderHasUnpaidSplits(db, sourceOrderId)) {
      return Response.json(
        {
          success: false,
          error: "Finish or cancel unpaid splits before moving items",
        },
        { status: 400 }
      );
    }

    const { data: table, error: tableErr } = await db
      .from("pos_tables")
      .select("id, status, is_active")
      .eq("id", target_table_id)
      .single();

    if (tableErr || !table) {
      return Response.json(
        { success: false, error: "Target table not found" },
        { status: 404 }
      );
    }

    if (table.is_active === false) {
      return Response.json(
        { success: false, error: "Target table is inactive" },
        { status: 400 }
      );
    }

    if (source.table_id && source.table_id === target_table_id) {
      return Response.json(
        { success: false, error: "Cannot transfer to the same table" },
        { status: 400 }
      );
    }

    let targetOrderId: string | null = null;
    let createdTarget = false;

    const sourceBill = {
      checkout_id: (source as { checkout_id?: string | null }).checkout_id ?? null,
      sold_from: (source as { sold_from?: string | null }).sold_from ?? null,
    };

    const existingTargets = await db
      .from("pos_orders")
      .select("id, order_number, status, payment_status, amount_paid, checkout_id, sold_from")
      .eq("table_id", target_table_id)
      .in("status", ACTIVE_STATUSES)
      .order("ordered_at", { ascending: false });

    const compatibleTarget = ((existingTargets.data || []) as Array<{
      id: string;
      order_number?: string | null;
      payment_status?: string | null;
      amount_paid?: number | string | null;
      checkout_id?: string | null;
      sold_from?: string | null;
    }>).find((row) => canAppendTransferItems(sourceBill, row));

    let targetOrderNumber: string | null = null;
    if (compatibleTarget) {
      // Bill tujuan yang sudah dibayar juga terkunci — item baru akan
      // menaikkan total tanpa pembayaran tambahan (insiden 2026-08-23).
      const targetBlocked = billBlocksItemMoves(compatibleTarget);
      if (targetBlocked) {
        return Response.json(
          {
            success: false,
            error: `Bill tujuan ${compatibleTarget.order_number || ""} ${targetBlocked} — tidak bisa menerima item`,
          },
          { status: 400 }
        );
      }
      targetOrderId = compatibleTarget.id;
      targetOrderNumber = compatibleTarget.order_number ?? null;
      if (await orderHasUnpaidSplits(db, targetOrderId)) {
        return Response.json(
          {
            success: false,
            error: "Target bill has unpaid splits",
          },
          { status: 400 }
        );
      }
    } else {
      const { data: orderNumData, error: orderNumErr } = await db.rpc(
        "generate_order_number"
      );
      if (orderNumErr) {
        return Response.json(
          { success: false, error: "Failed to generate order number" },
          { status: 500 }
        );
      }
      const orderNumber =
        typeof orderNumData === "string"
          ? orderNumData
          : String(orderNumData);
      const queueNumber = await allocateQueueNumber(
        db,
        (source as { company_id?: string | null }).company_id,
        (source as { branch_id?: string | null }).branch_id
      );

      const { data: newOrder, error: newOrderErr } = await db
        .from("pos_orders")
        .insert({
          order_number: orderNumber,
          queue_number: queueNumber,
          order_type: "dine_in",
          status: "pending",
          payment_status: "unpaid",
          company_id: (source as { company_id?: string | null }).company_id || null,
          branch_id: (source as { branch_id?: string | null }).branch_id || null,
          cashier_id: sessionUserId,
          table_id: target_table_id,
          sold_from: sourceBill.sold_from === "central" ? "central" : "stall",
          checkout_id: null,
          subtotal: 0,
          discount_amount: 0,
          tax_amount: 0,
          service_charge_amount: 0,
          total_amount: 0,
          payment_method: null,
          amount_paid: 0,
          ark_coins_used: 0,
          ordered_at: new Date().toISOString(),
          notes: "Created via Move Items",
        })
        .select("id")
        .single();

      if (newOrderErr || !newOrder) {
        return Response.json(
          {
            success: false,
            error: newOrderErr?.message || "Failed to create target bill",
          },
          { status: 500 }
        );
      }

      targetOrderId = newOrder.id;
      targetOrderNumber = orderNumber;
      createdTarget = true;

      await db
        .from("pos_tables")
        .update({
          status: "occupied",
          updated_at: new Date().toISOString(),
        })
        .eq("id", target_table_id);
    }

    if (!targetOrderId) {
      return Response.json(
        { success: false, error: "Could not resolve target order" },
        { status: 500 }
      );
    }

    const itemIds = items
      .map((item) => String(item.order_item_id || ""))
      .filter(Boolean);

    const { data: sourceItems, error: itemsErr } = await db
      .from("pos_order_items")
      .select("*")
      .eq("order_id", sourceOrderId)
      .in("id", itemIds);

    if (itemsErr) throw itemsErr;

    const byId = new Map(
      ((sourceItems || []) as OrderItemRow[]).map((row) => [row.id, row])
    );

    const movedItems: Array<{
      id: string;
      product_name: string | null;
      quantity: number;
      unit_price: number;
      total_amount: number;
    }> = [];

    for (const req of items) {
      const itemId = String(req.order_item_id || "");
      const qty = Math.floor(Number(req.qty) || 0);
      const row = byId.get(itemId);

      if (!row) {
        return Response.json(
          { success: false, error: `Item not found on source: ${itemId}` },
          { status: 400 }
        );
      }
      if (qty < 1 || qty > Number(row.quantity)) {
        return Response.json(
          {
            success: false,
            error: `Invalid qty for ${row.product_name || itemId}`,
          },
          { status: 400 }
        );
      }

      const unitPrice = Number(row.unit_price) || 0;
      const availableQty = Number(row.quantity) || 0;

      movedItems.push({
        id: row.id,
        product_name: row.product_name ?? null,
        quantity: qty,
        unit_price: unitPrice,
        total_amount:
          availableQty > 0
            ? (Number(row.total_amount || row.subtotal || 0) / availableQty) * qty
            : unitPrice * qty,
      });

      if (qty === availableQty) {
        const { error: moveErr } = await db
          .from("pos_order_items")
          .update({ order_id: targetOrderId })
          .eq("id", row.id);
        if (moveErr) throw moveErr;
      } else {
        const remainQty = availableQty - qty;
        const moveSubtotal = unitPrice * qty;
        const remainSubtotal = unitPrice * remainQty;
        const unitTotal =
          availableQty > 0
            ? Number(row.total_amount || row.subtotal || 0) / availableQty
            : unitPrice;
        const moveTotal = unitTotal * qty;
        const remainTotal = unitTotal * remainQty;

        const { error: shrinkErr } = await db
          .from("pos_order_items")
          .update({
            quantity: remainQty,
            subtotal: remainSubtotal,
            total_amount: remainTotal,
          })
          .eq("id", row.id);
        if (shrinkErr) throw shrinkErr;

        const insertPayload: Record<string, unknown> = {
          order_id: targetOrderId,
          product_id: row.product_id,
          product_name: row.product_name,
          product_sku: row.product_sku,
          variants: row.variants || [],
          modifiers: row.modifiers || [],
          quantity: qty,
          unit_price: unitPrice,
          subtotal: moveSubtotal,
          total_amount: moveTotal,
          station: row.station ?? null,
          kitchen_status: row.kitchen_status ?? "pending",
          kitchen_notes: row.kitchen_notes ?? null,
        };

        if (row.cost_price != null) {
          insertPayload.cost_price = row.cost_price;
          insertPayload.cost_total =
            Number(row.cost_price) * qty;
          insertPayload.gross_profit =
            moveTotal - Number(insertPayload.cost_total);
        }

        let { error: insertErr } = await db
          .from("pos_order_items")
          .insert(insertPayload);

        if (insertErr?.code === "42703" || insertErr?.code === "PGRST204") {
          const legacy = { ...insertPayload };
          delete legacy.station;
          delete legacy.kitchen_status;
          delete legacy.kitchen_notes;
          delete legacy.cost_price;
          delete legacy.cost_total;
          delete legacy.gross_profit;
          delete legacy.gross_margin_pct;
          const legacyResult = await db.from("pos_order_items").insert(legacy);
          insertErr = legacyResult.error;
        }
        if (insertErr) throw insertErr;
      }
    }

    const sourceTotals = await recalculateOrderTotals(db, sourceOrderId);
    await recalculateOrderTotals(db, targetOrderId);

    // Audit trail (insiden 2026-08-23): siapa memindahkan item apa, dari/ke
    // bill mana. Gagal menulis log tidak membatalkan transfer.
    await logOrderItemMove({
      action: "transfer",
      sourceOrderId,
      sourceOrderNumber: (source as { order_number?: string | null }).order_number ?? null,
      targetOrderId,
      targetOrderNumber,
      items: movedItems,
      movedBy: sessionUserId,
    });

    if (sourceTotals.itemCount === 0) {
      await db
        .from("pos_orders")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", sourceOrderId);

      if (source.table_id) {
        const { data: otherActive } = await db
          .from("pos_orders")
          .select("id")
          .eq("table_id", source.table_id)
          .in("status", ACTIVE_STATUSES)
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
    }

    return Response.json({
      success: true,
      data: {
        source_order_id: sourceOrderId,
        target_order_id: targetOrderId,
        created_target: createdTarget,
        message: "Items transferred successfully",
      },
    });
  } catch (error: unknown) {
    console.error("Transfer items error:", error);
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Transfer items failed",
      },
      { status: 500 }
    );
  }
}
