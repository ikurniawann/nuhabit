import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import type { Order } from "@/lib/pos-api";
import { orderCustomerLabel } from "@/lib/pos/order-customer";

type OrderLine = {
  id?: string;
  product_id?: string;
  product_name?: string;
  quantity?: number | string;
  unit_price?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
  variants?: Array<{ name?: string } | null> | null;
  modifiers?: Array<{ name?: string } | null> | null;
  kitchen_notes?: string | null;
  notes?: string | null;
};

/** Item order (jsonb list) → baris keranjang untuk struk thermal. */
export function orderItemsToCartItems(order: Order): PosCartItem[] {
  return ((order.items || []) as OrderLine[]).map((item, index) => {
    const quantity = Number(item.quantity) || 1;
    const lineTotal = Number(item.total_amount || item.subtotal || 0);
    const unitFromLine = quantity > 0 ? lineTotal / quantity : 0;
    const price = Number(item.unit_price) || unitFromLine;

    const variants = Array.isArray(item.variants) ? item.variants : [];
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];

    return {
      id: item.id || `${item.product_id || "item"}-${index}`,
      productId: item.product_id || "",
      name: item.product_name || "Item",
      price,
      quantity,
      variantName:
        variants.map((v) => v?.name).filter(Boolean).join(", ") || undefined,
      modifierNames: modifiers
        .map((m) => m?.name)
        .filter((name): name is string => Boolean(name)),
      notes: item.kitchen_notes || item.notes || undefined,
    };
  });
}

/** Build a thermal print payload for unpaid preview / pre-settlement bills. */
export function orderToPreviewReceipt(
  order: Order,
  tableLabel: string | null
): ReceiptPayload {
  const customerName = orderCustomerLabel(order, { withPhone: true });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    orderType: order.order_type || "dine_in",
    table: tableLabel,
    items: orderItemsToCartItems(order),
    notes: order.notes || "",
    total: Number(order.total_amount) || 0,
    change: 0,
    paymentMethod: "unpaid",
    customerName,
    discountAmount: Number(order.discount_amount) || 0,
    taxAmount: Number(order.tax_amount) || 0,
    chargesBreakdown: Array.isArray(order.charges_breakdown)
      ? order.charges_breakdown.map((line) => ({
          code: String(line.code || ""),
          name: String(line.name || line.code || "Charge"),
          kind: String(line.kind || "fee"),
          amount: Number(line.amount) || 0,
        }))
      : undefined,
  };
}
