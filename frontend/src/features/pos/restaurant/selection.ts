export type RestaurantSelection =
  | {
      type: "table";
      tableId: string;
      orderId?: string;
    }
  | {
      type: "bill";
      orderId: string;
      tableId?: string;
    };

export type NullableRestaurantSelection = RestaurantSelection | null;

export function tableSelection(
  tableId: string,
  orderId?: string
): RestaurantSelection {
  return {
    type: "table",
    tableId,
    ...(orderId ? { orderId } : {}),
  };
}

export function billSelection(
  orderId: string,
  tableId?: string
): RestaurantSelection {
  return {
    type: "bill",
    orderId,
    ...(tableId ? { tableId } : {}),
  };
}

export function isTableSelected(
  selection: NullableRestaurantSelection,
  tableId: string
) {
  return selection?.tableId === tableId;
}

export function isBillSelected(
  selection: NullableRestaurantSelection,
  orderId: string
) {
  return selection?.orderId === orderId;
}
