/**
 * Handoff URL → kasir (murni). Menentukan langkah sekali-jalan saat kasir
 * dibuka dari Orders / Restaurant / menu: muat open bill ke keranjang,
 * kosongkan keranjang bila masuk tanpa handoff, buka modal bayar (?pay=1),
 * dan terapkan meja / tipe order dari Restaurant. Urutan langkah = urutan
 * eksekusi.
 */

import type { Dispatch } from "react";
import type { CashierCheckout, CashierOrder, CashierOrderItem } from "./api";
import type { CashierSessionAction, CashierSessionState } from "./cashier-session";
import type { PosCartItem, usePosCart } from "@/hooks/use-pos-cart";

export type CartOrderType = "dine_in" | "takeaway" | "delivery" | "self_order";

export interface HandoffParams {
  orderId: string | null;
  checkoutId: string | null;
  tableId: string | null;
  orderType: string | null;
  fromRestaurant: boolean;
  autoPay: boolean;
  /** Masuk dari menu tanpa handoff: keranjang harus kosong. */
  freshEntry: boolean;
}

export interface LoadedBill {
  key: string;
  number: string | null;
  orderType: CartOrderType;
  tableId: string | null;
  customerId: string | null;
  notes: string;
  lines: PosCartItem[];
  /** Hanya checkout kasir-pusat: baris yang sudah tersimpan di server. */
  persistedItemIds?: string[];
}

export type HandoffStep =
  | { type: "loadBill"; bill: LoadedBill }
  | { type: "freshReset" }
  | { type: "autoPay" }
  | {
      type: "restaurant";
      key: string;
      /** null = biarkan tipe order. */
      orderType: "dine_in" | "takeaway" | null;
      /** undefined = biarkan meja; null = lepas meja. */
      tableId: string | null | undefined;
    };

/** Harga per unit = total baris / qty, persis seperti saat order dibuat. */
export function billLine(
  item: CashierOrderItem,
  index: number,
  withWarehouse: boolean
): PosCartItem {
  const qty = Number(item.quantity) || 1;
  const variants = Array.isArray(item.variants) ? item.variants : [];
  const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
  return {
    id: item.id || `${item.product_id}-${index}`,
    productId: item.product_id,
    name: item.product_name,
    price: Number(item.total_amount || item.subtotal || item.unit_price || 0) / qty,
    quantity: qty,
    variantName: variants.map((v) => v?.name).filter(Boolean).join(", ") || undefined,
    modifierNames: modifiers.map((m) => m?.name).filter((name): name is string => Boolean(name)),
    station: item.station,
    ...(withWarehouse ? { warehouse_id: item.warehouse_id ?? undefined } : {}),
  };
}

function toLoadedBill(
  key: string,
  bill: CashierOrder,
  number: string | null,
  isCheckout: boolean
): LoadedBill {
  const lines = (bill.items || []).map((item, index) => billLine(item, index, isCheckout));
  return {
    key,
    number,
    orderType: (bill.order_type as CartOrderType) || "dine_in",
    tableId: bill.table_id || null,
    customerId: bill.customer_id || null,
    notes: bill.notes || "",
    lines,
    ...(isCheckout ? { persistedItemIds: lines.map((line) => line.id) } : {}),
  };
}

function isDineOrTakeaway(value: string | null): value is "dine_in" | "takeaway" {
  return value === "dine_in" || value === "takeaway";
}

export function planHandoff(input: {
  hydrated: boolean;
  params: HandoffParams;
  order: CashierOrder | undefined;
  checkout: CashierCheckout | undefined;
  session: Pick<CashierSessionState, "bill" | "handoff">;
}): HandoffStep[] {
  const { hydrated, params, order, checkout, session } = input;
  const steps: HandoffStep[] = [];

  if (hydrated) {
    if (params.checkoutId) {
      const key = `checkout:${params.checkoutId}`;
      if (checkout && session.bill.key !== key) {
        const number = checkout.order_number || checkout.checkout_number || null;
        steps.push({ type: "loadBill", bill: toLoadedBill(key, checkout, number, true) });
      }
    } else if (params.orderId) {
      const key = `order:${params.orderId}`;
      if (order && session.bill.key !== key) {
        steps.push({
          type: "loadBill",
          bill: toLoadedBill(key, order, order.order_number || null, false),
        });
      }
    }

    if (!session.handoff.freshResetDone && params.freshEntry) {
      steps.push({ type: "freshReset" });
    }
  }

  // ?pay=1 (mis. Pre Settlement dari Restaurant): buka modal bayar begitu bill siap.
  if (params.autoPay && !session.handoff.autoPayDone) {
    const ready = params.checkoutId ? Boolean(checkout) : Boolean(params.orderId && order);
    if (ready) steps.push({ type: "autoPay" });
  }

  // Setelah keranjang ter-hydrate dari localStorage supaya meja dari URL menang.
  if (hydrated && params.fromRestaurant) {
    const key = [params.tableId, params.orderType, params.orderId, params.checkoutId]
      .map((part) => part ?? "")
      .join("|");
    if (session.handoff.restaurantKey !== key) {
      const orderType = isDineOrTakeaway(params.orderType) ? params.orderType : null;
      steps.push({
        type: "restaurant",
        key,
        orderType: params.tableId ? "dine_in" : orderType,
        tableId: params.tableId ? params.tableId : orderType ? null : undefined,
      });
    }
  }

  return steps;
}

/** Jalankan langkah handoff ke keranjang + sesi (dipanggil saat render, sekali per kunci). */
export function applyHandoff(
  steps: HandoffStep[],
  cart: ReturnType<typeof usePosCart>,
  dispatch: Dispatch<CashierSessionAction>
) {
  for (const step of steps) {
    if (step.type === "loadBill") {
      const { bill } = step;
      cart.clearCart();
      cart.setOrderType(bill.orderType);
      for (const line of bill.lines) cart.addItem(line);
      cart.setTable(bill.tableId);
      cart.setCustomer(bill.customerId);
      cart.setNotes(bill.notes);
      dispatch({
        type: "billLoaded",
        key: bill.key,
        number: bill.number,
        persistedItemIds: bill.persistedItemIds,
      });
    } else if (step.type === "freshReset") {
      cart.clearCart();
      dispatch({ type: "freshReset" });
    } else if (step.type === "autoPay") {
      dispatch({ type: "autoPayApplied" });
    } else {
      if (step.orderType) cart.setOrderType(step.orderType);
      if (step.tableId !== undefined) cart.setTable(step.tableId);
      dispatch({ type: "restaurantHandoffApplied", key: step.key });
    }
  }
}
