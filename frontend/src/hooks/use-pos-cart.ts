"use client";

import { useReducer, useCallback, useEffect, useMemo } from "react";
import {
  calculateBillCharges,
  DEFAULT_BILLING_CHARGES,
  resolveEnabledOptionalCodes,
} from "@/lib/pos/billing-settings";
import {
  computeDiscountAmount,
  computeOrderDiscountStack,
  type DiscountType,
} from "@/lib/pos/manual-discount";
import { POS_CART_STORAGE_KEY } from "@/lib/pos/pos-sell-stall";

export { POS_CART_STORAGE_KEY };

export interface PosCartItem {
  id: string;               // composite: productId + variant + modifier join
  productId: string;
  /** EPIC-039 Fase B — varian merchandise ber-stok (pos_product_skus.id) */
  skuId?: string;
  /** Kode SKU varian utk struk/product_sku */
  skuCode?: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  variantName?: string;
  variantPriceAdj?: number;
  modifierNames?: string[];
  modifierPriceAdj?: number;
  imageUrl?: string;
  station?: string;
  warehouse_id?: string;
  warehouse_name?: string | null;
  /** Stall asal item — tercetak di struk/CO saat transaksi lintas stall */
  stallName?: string;
  /** Manual line discount */
  discount_type?: DiscountType | null;
  discount_value?: number | null;
}

interface CartState {
  items: PosCartItem[];
  orderType: "dine_in" | "takeaway" | "delivery" | "self_order";
  selectedTable: string | null;
  selectedCustomerId: string | null;
  notes: string;
  includeTax: boolean;
  includeService: boolean;
  manual_discount_type: DiscountType | null;
  manual_discount_value: number | null;
}

type CartAction =
  | { type: "ADD_ITEM"; item: PosCartItem }
  | { type: "UPDATE_QTY"; id: string; delta: number }
  | { type: "REMOVE_ITEM"; id: string }
  | { type: "CLEAR_CART" }
  | { type: "CLEAR_ITEMS" }
  | { type: "SET_ORDER_TYPE"; orderType: CartState["orderType"] }
  | { type: "SET_TABLE"; table: string | null }
  | { type: "SET_CUSTOMER"; customerId: string | null }
  | { type: "SET_NOTES"; notes: string }
  | { type: "SET_INCLUDE_TAX"; include: boolean }
  | { type: "SET_INCLUDE_SERVICE"; include: boolean }
  | {
      type: "SET_ITEM_DISCOUNT";
      id: string;
      discount_type: DiscountType | null;
      discount_value: number | null;
    }
  | {
      type: "SET_MANUAL_DISCOUNT";
      discount_type: DiscountType | null;
      discount_value: number | null;
    }
  | { type: "HYDRATE"; state: CartState };

const STORAGE_KEY = POS_CART_STORAGE_KEY;

export const DEFAULT_CART_STATE: CartState = {
  items: [],
  orderType: "dine_in",
  selectedTable: null,
  selectedCustomerId: null,
  notes: "",
  includeTax: false,
  includeService: true,
  manual_discount_type: null,
  manual_discount_value: null,
};

function normalizeCartState(raw: Partial<CartState> | null | undefined): CartState {
  return {
    ...DEFAULT_CART_STATE,
    ...raw,
    includeTax: raw?.includeTax ?? false,
    includeService: raw?.includeService ?? true,
    items: Array.isArray(raw?.items) ? raw.items : [],
    manual_discount_type: raw?.manual_discount_type ?? null,
    manual_discount_value:
      raw?.manual_discount_value == null ? null : Number(raw.manual_discount_value),
  };
}

function readStoredCartState(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeCartState(JSON.parse(raw) as Partial<CartState>);
    }
  } catch {
    /* noop */
  }
  return DEFAULT_CART_STATE;
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existing = state.items.find(
        (i) =>
          i.productId === action.item.productId &&
          i.variantName === action.item.variantName &&
          JSON.stringify(i.modifierNames) === JSON.stringify(action.item.modifierNames)
      );
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i === existing
              ? {
                  ...i,
                  quantity: i.quantity + action.item.quantity,
                  notes: action.item.notes || i.notes,
                }
              : i
          ),
        };
      }
      return { ...state, items: [...state.items, action.item] };
    }
    case "UPDATE_QTY": {
      return {
        ...state,
        items: state.items
          .map((i) =>
            i.id === action.id ? { ...i, quantity: Math.max(0, i.quantity + action.delta) } : i
          )
          .filter((i) => i.quantity > 0),
      };
    }
    case "REMOVE_ITEM":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "CLEAR_CART":
      return {
        ...state,
        items: [],
        selectedTable: null,
        selectedCustomerId: null,
        notes: "",
        manual_discount_type: null,
        manual_discount_value: null,
      };
    case "CLEAR_ITEMS":
      return {
        ...state,
        items: [],
        notes: "",
        manual_discount_type: null,
        manual_discount_value: null,
      };
    case "SET_ORDER_TYPE":
      return {
        ...state,
        orderType: action.orderType,
        selectedTable: action.orderType === "dine_in" ? state.selectedTable : null,
      };
    case "SET_TABLE":
      return { ...state, selectedTable: action.table };
    case "SET_CUSTOMER":
      return { ...state, selectedCustomerId: action.customerId };
    case "SET_NOTES":
      return { ...state, notes: action.notes };
    case "SET_INCLUDE_TAX":
      return { ...state, includeTax: action.include };
    case "SET_INCLUDE_SERVICE":
      return { ...state, includeService: action.include };
    case "SET_ITEM_DISCOUNT":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? {
                ...i,
                discount_type: action.discount_type,
                discount_value: action.discount_value,
              }
            : i
        ),
      };
    case "SET_MANUAL_DISCOUNT":
      return {
        ...state,
        manual_discount_type: action.discount_type,
        manual_discount_value: action.discount_value,
      };
    case "HYDRATE":
      return normalizeCartState(action.state);
    default:
      return state;
  }
}

export function lineGross(item: PosCartItem): number {
  return Number(item.price) * Number(item.quantity);
}

export function lineDiscountAmount(item: PosCartItem): number {
  return computeDiscountAmount(lineGross(item), item.discount_type, item.discount_value);
}

/** Keranjang + penanda sudah dimuat dari localStorage (HYDRATE pertama). */
type HydratingCart = { cart: CartState; hydrated: boolean };

function hydratingCartReducer(current: HydratingCart, action: CartAction): HydratingCart {
  const cart = cartReducer(current.cart, action);
  const hydrated = current.hydrated || action.type === "HYDRATE";
  return cart === current.cart && hydrated === current.hydrated ? current : { cart, hydrated };
}

export function usePosCart() {
  const [{ cart: state, hydrated }, dispatch] = useReducer(hydratingCartReducer, {
    cart: DEFAULT_CART_STATE,
    hydrated: false,
  });

  // Muat dari localStorage setelah mount (SSR & render pertama klien tetap kosong).
  useEffect(() => {
    dispatch({ type: "HYDRATE", state: readStoredCartState() });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const addItem = useCallback((item: PosCartItem) => dispatch({ type: "ADD_ITEM", item }), []);
  const updateQty = useCallback(
    (id: string, delta: number) => dispatch({ type: "UPDATE_QTY", id, delta }),
    []
  );
  const removeItem = useCallback((id: string) => dispatch({ type: "REMOVE_ITEM", id }), []);
  const clearCart = useCallback(() => dispatch({ type: "CLEAR_CART" }), []);
  const clearItems = useCallback(() => dispatch({ type: "CLEAR_ITEMS" }), []);
  const setOrderType = useCallback(
    (orderType: CartState["orderType"]) => dispatch({ type: "SET_ORDER_TYPE", orderType }),
    []
  );
  const setTable = useCallback(
    (table: string | null) => dispatch({ type: "SET_TABLE", table }),
    []
  );
  const setCustomer = useCallback(
    (customerId: string | null) => dispatch({ type: "SET_CUSTOMER", customerId }),
    []
  );
  const setNotes = useCallback((notes: string) => dispatch({ type: "SET_NOTES", notes }), []);
  const setIncludeTax = useCallback(
    (include: boolean) => dispatch({ type: "SET_INCLUDE_TAX", include }),
    []
  );
  const setIncludeService = useCallback(
    (include: boolean) => dispatch({ type: "SET_INCLUDE_SERVICE", include }),
    []
  );
  const setItemDiscount = useCallback(
    (id: string, discount_type: DiscountType | null, discount_value: number | null) =>
      dispatch({ type: "SET_ITEM_DISCOUNT", id, discount_type, discount_value }),
    []
  );
  const setManualDiscount = useCallback(
    (discount_type: DiscountType | null, discount_value: number | null) =>
      dispatch({ type: "SET_MANUAL_DISCOUNT", discount_type, discount_value }),
    []
  );

  const grossSubtotal = useMemo(
    () => state.items.reduce((sum, i) => sum + lineGross(i), 0),
    [state.items]
  );

  const itemDiscountTotal = useMemo(
    () => state.items.reduce((sum, i) => sum + lineDiscountAmount(i), 0),
    [state.items]
  );

  /** Net after line discounts (before membership/promo/manual). */
  const itemsSubtotal = grossSubtotal - itemDiscountTotal;

  // Legacy alias: subtotal = gross (before line discount) for payload order.subtotal
  const subtotal = grossSubtotal;

  const bill = calculateBillCharges({
    subtotalAfterDiscount: itemsSubtotal,
    charges: DEFAULT_BILLING_CHARGES,
    enabledOptionalCodes: resolveEnabledOptionalCodes(
      DEFAULT_BILLING_CHARGES,
      state.includeTax,
      state.includeService
    ),
  });
  const tax = bill.tax_amount;
  const total = bill.total;
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return {
    ...state,
    hydrated,
    subtotal,
    grossSubtotal,
    itemDiscountTotal,
    itemsSubtotal,
    tax,
    total,
    itemCount,
    addItem,
    updateQty,
    removeItem,
    clearCart,
    clearItems,
    setOrderType,
    setTable,
    setCustomer,
    setNotes,
    setIncludeTax,
    setIncludeService,
    setItemDiscount,
    setManualDiscount,
    /** Helper for callers that need full stack with external membership/promo */
    buildDiscountStack: (
      membership_pct: number,
      promo_discount: number,
      offer_discount = 0
    ) =>
      computeOrderDiscountStack({
        items: state.items.map((i) => ({
          line_subtotal: lineGross(i),
          discount_type: i.discount_type,
          discount_value: i.discount_value,
        })),
        offer_discount,
        membership_pct,
        promo_discount,
        manual_discount_type: state.manual_discount_type,
        manual_discount_value: state.manual_discount_value,
      }),
  };
}
