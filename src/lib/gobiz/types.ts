/** Tipe integrasi GoBiz / GoFood (EPIC-049) — mengikuti developer.gobiz.com. */

export type GobizEnvironment = "sandbox" | "production";

export type GofoodOrderType = "delivery" | "pickup";

/** Status internal pos.gofood_orders (CHECK di migrasi 20260912130000). */
export type GofoodOrderStatus =
  | "created"
  | "awaiting_acceptance"
  | "accepted"
  | "rejected"
  | "driver_otw_pickup"
  | "driver_arrived"
  | "placed"
  | "completed"
  | "cancelled"
  | "error";

export type GofoodCancelReasonCode =
  | "HIGH_DEMAND"
  | "RESTAURANT_CLOSED"
  | "ITEMS_OUT_OF_STOCK"
  | "OTHERS";

/** Event webhook GoBiz yang relevan utk POS (docs: /docs/api/event-list). */
export const GOFOOD_WEBHOOK_EVENTS = [
  "gofood.order.created",
  "gofood.order.awaiting_merchant_acceptance",
  "gofood.order.merchant_accepted",
  "gofood.order.driver_otw_pickup",
  "gofood.order.driver_arrived",
  "gofood.order.placed",
  "gofood.order.completed",
  "gofood.order.cancelled",
  "gofood.order.webhook_error",
  "gofood.catalog.menu_mapping_updated",
] as const;

export type GofoodWebhookEventName = (typeof GOFOOD_WEBHOOK_EVENTS)[number];

export type GofoodWebhookItemVariant = {
  id?: string;
  name?: string;
  external_id?: string | null;
};

export type GofoodWebhookItem = {
  id?: string;
  external_id?: string | null;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
  variants?: GofoodWebhookItemVariant[];
};

export type GofoodWebhookEvent = {
  header: {
    event_name: string;
    event_id: string;
    version?: number;
    timestamp?: string;
  };
  body: {
    service_type?: string; // "gofood" | "gofood_pickup"
    customer?: { id?: string; name?: string };
    driver?: { name?: string };
    outlet?: { id?: string; external_outlet_id?: string };
    order?: {
      status?: string;
      pin?: string;
      order_number?: string;
      order_total?: number;
      currency?: string;
      order_items?: GofoodWebhookItem[];
      cutlery_requested?: boolean;
      takeaway_charges?: number;
      created_at?: string;
      cancellation_detail?: { reason?: string };
      scheduled_flag?: {
        is_catering?: boolean;
        schedule_delivery_time_start?: string;
        schedule_delivery_time_end?: string;
      };
    };
  };
};

/** Payload PUT /integrations/gofood/outlets/{outlet_id}/v1/catalog (full replace). */
export type GobizCatalogPayload = {
  request_id: string;
  menus: Array<{
    name: string;
    menu_items: Array<{
      external_id: string;
      name: string;
      description?: string;
      in_stock: boolean;
      price: number;
      image?: string;
      variant_category_external_ids?: string[];
    }>;
  }>;
  variant_categories: Array<{
    external_id: string;
    internal_name?: string;
    name: string;
    rules: { selection: { min_quantity: number; max_quantity: number } };
    variants: Array<{ external_id: string; name: string; price: number; in_stock: boolean }>;
  }>;
};

/** Baris item order GoFood yang sudah dipetakan ke katalog POS. */
export type MappedGofoodLine = {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  /** Harga satuan dari GoFood (yang dibayar pelanggan, sudah termasuk varian). */
  unit_price: number;
  variant_name: string | null;
  /** Add-on POS yang dipilih di GoFood — bentuk sama dgn kasir ({ name, group, price }). */
  modifiers?: Array<{ name: string; group: string; price: number }>;
  notes: string | null;
  station: string;
};

export type UnmappedGofoodLine = {
  gofood_item_id: string | null;
  external_id: string | null;
  name: string;
  quantity: number;
  price: number;
  reason: "no_external_id" | "product_not_found";
};
