import type { DbClient } from "@/lib/pg/types";

export const POS_STATIONS = [
  "kitchen",
  "bar",
  "bakery",
  "dessert",
  "merchandise",
  "photobooth",
] as const;

export type PosStation = (typeof POS_STATIONS)[number];

export const POS_STATION_OPTIONS: { value: PosStation; label: string }[] = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "bakery", label: "Bakery" },
  { value: "dessert", label: "Dessert" },
  { value: "merchandise", label: "Merchandise" },
  { value: "photobooth", label: "Photobooth" },
];

export function posStationLabel(value?: string | null): string {
  const station = String(value || "").trim().toLowerCase();
  return POS_STATION_OPTIONS.find((option) => option.value === station)?.label || station || "-";
}

export function resolvePosStation(
  explicit?: string | null,
  kategori?: string | null
): PosStation {
  const lower = String(explicit || "").trim().toLowerCase();
  if (POS_STATIONS.includes(lower as PosStation)) return lower as PosStation;
  return normalizeStation(null, String(kategori || ""), "");
}

export function normalizeStation(
  value?: string | null,
  productName = "",
  kitchenNotes = ""
): PosStation {
  const lower = String(value || "").trim().toLowerCase();
  if (POS_STATIONS.includes(lower as PosStation)) return lower as PosStation;

  const haystack = `${productName} ${kitchenNotes}`.toLowerCase();
  if (
    /kopi|coffee|tea|teh|minuman|drink|juice|jus|soda|es|latte|cappuccino|mocktail|milkshake|bar/.test(
      haystack
    )
  ) {
    return "bar";
  }
  if (
    /roti|bread|pastry|cake|kue|croissant|donut|dessert|ice cream|gelato|bakery/.test(
      haystack
    )
  ) {
    return "bakery";
  }
  return "kitchen";
}

export type KitchenPrintItem = {
  id?: string;
  product_id?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  variants?: unknown;
  modifiers?: unknown;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
  station?: string | null;
  kitchen_notes?: string | null;
};

export function buildKitchenPrintJobs(
  order: Record<string, unknown>,
  insertedItems: KitchenPrintItem[]
) {
  const stationGroups = new Map<string, KitchenPrintItem[]>();

  insertedItems.forEach((item) => {
    const station = normalizeStation(
      item.station,
      item.product_name || "",
      item.kitchen_notes || ""
    );
    if (station === "merchandise" || station === "photobooth") return;
    stationGroups.set(station, [...(stationGroups.get(station) || []), item]);
  });

  return Array.from(stationGroups.entries()).map(([station, stationItems]) => ({
    order_id: order.id,
    station,
    job_type: station === "bar" ? "bar_ticket" : "kitchen_ticket",
    status: "pending",
    payload: {
      order_id: order.id,
      order_number: order.order_number,
      queue_number: order.queue_number || null,
      order_type: order.order_type,
      table_id: order.table_id,
      station,
      requested_at: new Date().toISOString(),
      items: stationItems.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        variants: item.variants || [],
        modifiers: item.modifiers || [],
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total_amount: Number(item.total_amount) || 0,
        notes: item.kitchen_notes || "",
      })),
    },
  }));
}

export async function backfillMissingItemStations(db: DbClient, orderId: string) {
  const { data: items, error } = await db
    .from("pos_order_items")
    .select("id, product_id, product_name, kitchen_notes, station, kitchen_status")
    .eq("order_id", orderId);

  if (error || !items?.length) return;

  type ItemRow = {
    id: string;
    product_id: string | null;
    product_name: string | null;
    kitchen_notes: string | null;
    station: string | null;
    kitchen_status: string | null;
  };
  const missing = (items as ItemRow[]).filter((item) => !String(item.station || "").trim());
  if (missing.length === 0) return;

  const productIds = missing
    .map((item) => item.product_id)
    .filter((id): id is string => Boolean(id));
  const productStation = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await db
      .from("pos_products")
      .select("id, station")
      .in("id", productIds);
    for (const product of products || []) {
      productStation.set(String(product.id), String(product.station || ""));
    }
  }

  for (const item of missing) {
    const station = normalizeStation(
      productStation.get(String(item.product_id || "")) || null,
      String(item.product_name || ""),
      String(item.kitchen_notes || "")
    );
    await db
      .from("pos_order_items")
      .update({
        station,
        kitchen_status: item.kitchen_status || "pending",
      })
      .eq("id", item.id);
  }
}
