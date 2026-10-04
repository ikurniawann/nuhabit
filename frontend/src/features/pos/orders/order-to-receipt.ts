import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import type { Order } from "@/features/pos/orders/types";

function asNamedList(value: unknown): Array<{ name?: string }> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is { name?: string } => entry != null && typeof entry === "object");
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter(
      (entry): entry is { name?: string } => entry != null && typeof entry === "object",
    );
  }
  return [];
}

/** Map list/detail order row into the shared thermal receipt payload. */
export function orderToReceiptPayload(order: Order): ReceiptPayload {
  const items: PosCartItem[] = (order.items || []).map((item, index) => {
    const row = item as {
      product_id?: string;
      product_name?: string;
      quantity?: number;
      unit_price?: number;
      total_amount?: number;
      station?: string;
      kitchen_notes?: string;
      notes?: string;
      variants?: unknown;
      modifiers?: unknown;
    };
    const qty = Number(row.quantity) || 0;
    const lineTotal = Number(row.total_amount);
    const unit = Number(row.unit_price);
    const price =
      Number.isFinite(unit) && unit > 0
        ? unit
        : qty > 0 && Number.isFinite(lineTotal)
          ? lineTotal / qty
          : 0;

    const variants = asNamedList(row.variants);
    const modifiers = asNamedList(row.modifiers);
    const modifierNames = modifiers
      .map((m) => m.name)
      .filter((name): name is string => Boolean(name));

    return {
      id: `${row.product_id || "item"}-${index}`,
      productId: row.product_id || "",
      name: row.product_name || "Item",
      price,
      quantity: qty,
      notes: row.kitchen_notes || row.notes,
      variantName: variants[0]?.name,
      modifierNames: modifierNames.length > 0 ? modifierNames : undefined,
      station: row.station,
    };
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    queueNumber: order.queue_number,
    orderType: order.order_type || "dine_in",
    table: order.table?.table_number || null,
    items,
    notes: order.notes || "",
    total: Number(order.total_amount) || 0,
    change: Number(order.change_amount) || 0,
    paymentMethod: order.payment_method || "unpaid",
    customerName: order.customer?.name,
    discountAmount: Number(order.discount_amount) || 0,
    taxAmount: Number(order.tax_amount) || 0,
    chargesBreakdown: order.charges_breakdown || undefined,
    // EPIC-041: reprint memuat ARK terpakai dari baris order. Sisa saldo,
    // XP, dan total XP SENGAJA tidak diisi — semuanya snapshot saat bayar
    // (XP hidup di pos_xp_transactions, bukan kolom order), dan struk
    // reprint tidak boleh menebak nilai historis.
    arkPaid: Number((order as { ark_coins_used?: number | string }).ark_coins_used) || 0,
    // EPIC-043 — reprint komplimen tetap berlabel (KOL/Owner + penyetuju).
    compType: (order as { comp_type?: string | null }).comp_type ?? null,
    compApprovedName:
      (order as { comp_approved_name?: string | null }).comp_approved_name ?? null,
  };
}

/**
 * Cetak ulang checkout multi-stall (fix 2026-08-23): reprint dulu hanya
 * memuat SATU anak-order (order yang diklik) sehingga item stall lain hilang
 * dari struk — apa pun metode bayarnya. Payload ini menggabungkan SEMUA
 * anak-order: item diberi stallName masing-masing (struk menampilkan label
 * [Stall] per item), angka-angka dijumlah, identitas dari keluarga checkout.
 */
export function checkoutFamilyToReceiptPayload(orders: Order[]): ReceiptPayload {
  const primary = orders[0];
  const sum = (pick: (o: Order) => unknown) =>
    orders.reduce((total, o) => total + (Number(pick(o)) || 0), 0);

  const items: PosCartItem[] = orders.flatMap((child) => {
    const stallName =
      (child as { stall_name?: string | null }).stall_name?.trim() || null;
    return orderToReceiptPayload(child).items.map((item, index) => ({
      ...item,
      id: `${child.id}-${item.id}-${index}`,
      stallName: stallName ?? undefined,
      warehouse_id: (child as { warehouse_id?: string | null }).warehouse_id ?? undefined,
      warehouse_name: stallName ?? undefined,
    }));
  });

  const paidChild = orders.find((o) => o.payment_method) ?? primary;

  return {
    orderId: primary.id,
    orderNumber: primary.order_number,
    checkoutNumber:
      (primary as { checkout_number?: string | null }).checkout_number || undefined,
    queueNumber: primary.queue_number,
    orderType: primary.order_type || "dine_in",
    table: primary.table?.table_number || null,
    items,
    notes: primary.notes || "",
    total: sum((o) => o.total_amount),
    change: sum((o) => o.change_amount),
    paymentMethod: paidChild.payment_method || "unpaid",
    customerName: primary.customer?.name,
    subtotal: sum((o) => (o as { subtotal?: number | string }).subtotal),
    discountAmount: sum((o) => o.discount_amount),
    taxAmount: sum((o) => o.tax_amount),
    arkPaid: sum((o) => (o as { ark_coins_used?: number | string }).ark_coins_used),
    compType:
      orders
        .map((o) => (o as { comp_type?: string | null }).comp_type)
        .find(Boolean) ?? null,
    compApprovedName:
      orders
        .map((o) => (o as { comp_approved_name?: string | null }).comp_approved_name)
        .find(Boolean) ?? null,
  };
}
