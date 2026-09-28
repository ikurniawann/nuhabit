/**
 * Pemetaan event webhook GoBiz → data order POS (murni, teruji).
 * Bentuk payload mengikuti contoh di developer.gobiz.com/docs/api/event-list.
 */

import { z } from "zod";
import type {
  GofoodOrderStatus,
  GofoodOrderType,
  GofoodWebhookEvent,
  GofoodWebhookItem,
  MappedGofoodLine,
  UnmappedGofoodLine,
} from "./types";

const numberish = z.preprocess((value) => (value == null || value === "" ? 0 : Number(value)), z.number());

const itemSchema = z.object({
  id: z.string().optional(),
  external_id: z.string().nullable().optional(),
  name: z.string().default(""),
  quantity: numberish.default(1),
  price: numberish.default(0),
  notes: z.string().nullable().optional(),
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        external_id: z.string().nullable().optional(),
      })
    )
    .optional(),
});

const eventSchema = z.object({
  header: z.object({
    event_name: z.string().min(1),
    event_id: z.string().min(1),
    version: z.number().optional(),
    timestamp: z.string().optional(),
  }),
  body: z
    .object({
      service_type: z.string().optional(),
      customer: z.object({ id: z.string().optional(), name: z.string().optional() }).partial().optional(),
      driver: z.object({ name: z.string().optional() }).partial().optional(),
      outlet: z
        .object({ id: z.string().optional(), external_outlet_id: z.string().optional() })
        .partial()
        .optional(),
      order: z
        .object({
          status: z.string().optional(),
          pin: z.string().optional(),
          order_number: z.string().optional(),
          order_total: numberish.optional(),
          currency: z.string().optional(),
          order_items: z.array(itemSchema).optional(),
          cutlery_requested: z.boolean().optional(),
          takeaway_charges: numberish.optional(),
          created_at: z.string().optional(),
          cancellation_detail: z.object({ reason: z.string().optional() }).partial().optional(),
          scheduled_flag: z
            .object({
              is_catering: z.boolean().optional(),
              schedule_delivery_time_start: z.string().optional(),
              schedule_delivery_time_end: z.string().optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .default({}),
});

/** Validasi bentuk event; null bila bukan event GoBiz yang dikenali. */
export function parseGofoodWebhook(json: unknown): GofoodWebhookEvent | null {
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data as GofoodWebhookEvent;
}

export function gofoodOrderTypeFromServiceType(serviceType: string | null | undefined): GofoodOrderType {
  return /pickup/i.test(String(serviceType || "")) ? "pickup" : "delivery";
}

/** Status internal yang dihasilkan sebuah event (null = event tidak mengubah status). */
export function statusFromEventName(eventName: string): GofoodOrderStatus | null {
  switch (eventName) {
    case "gofood.order.created":
      return "created";
    case "gofood.order.awaiting_merchant_acceptance":
      return "awaiting_acceptance";
    case "gofood.order.merchant_accepted":
      return "accepted";
    case "gofood.order.driver_otw_pickup":
      return "driver_otw_pickup";
    case "gofood.order.driver_arrived":
      return "driver_arrived";
    case "gofood.order.placed":
      return "placed";
    case "gofood.order.completed":
      return "completed";
    case "gofood.order.cancelled":
      return "cancelled";
    default:
      return null;
  }
}

const STATUS_RANK: Record<GofoodOrderStatus, number> = {
  created: 0,
  awaiting_acceptance: 1,
  accepted: 2,
  driver_otw_pickup: 3,
  driver_arrived: 4,
  placed: 5,
  completed: 6,
  rejected: 9,
  cancelled: 9,
  error: 9,
};

/**
 * Event bisa datang tidak berurutan / dobel — status hanya maju, kecuali
 * terminal (cancelled/rejected/completed) yang selalu menang.
 */
export function shouldAdvanceStatus(current: GofoodOrderStatus, next: GofoodOrderStatus) {
  if (current === next) return false;
  if (next === "cancelled" || next === "rejected" || next === "completed") {
    return current !== "completed" && current !== "cancelled" && current !== "rejected";
  }
  if (current === "cancelled" || current === "rejected" || current === "completed") return false;
  return STATUS_RANK[next] > STATUS_RANK[current];
}

export type CatalogProductRef = {
  id: string;
  name: string;
  sku: string;
  station: string;
  variants: Array<{ id: string; name: string }>;
  /** Opsi add-on produk (id pos_modifiers) — harga = harga GoFood saat katalog disinkron. */
  modifiers?: Array<{ id: string; name: string; groupName: string; price: number }>;
};

/** Petakan item GoFood ke produk POS via external_id (= id pos_products). */
export function mapGofoodItems(
  items: GofoodWebhookItem[],
  productsById: Map<string, CatalogProductRef>
): { lines: MappedGofoodLine[]; unmapped: UnmappedGofoodLine[] } {
  const lines: MappedGofoodLine[] = [];
  const unmapped: UnmappedGofoodLine[] = [];

  for (const item of items) {
    const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
    const price = Math.max(0, Math.round(Number(item.price) || 0));
    const externalId = item.external_id ? String(item.external_id) : null;
    const product = externalId ? productsById.get(externalId) : undefined;

    if (!externalId || !product) {
      unmapped.push({
        gofood_item_id: item.id ?? null,
        external_id: externalId,
        name: item.name,
        quantity,
        price,
        reason: externalId ? "product_not_found" : "no_external_id",
      });
      continue;
    }

    // Pilihan GoFood = varian POS atau add-on POS (external_id menentukan);
    // yang tak dikenali tetap ditampilkan sbg teks varian supaya dapur tahu.
    const variantNames: string[] = [];
    const modifiers: NonNullable<MappedGofoodLine["modifiers"]> = [];
    for (const variant of item.variants ?? []) {
      const externalVariantId = variant.external_id ? String(variant.external_id) : null;
      const modifier = externalVariantId
        ? product.modifiers?.find((candidate) => candidate.id === externalVariantId)
        : undefined;
      if (modifier) {
        modifiers.push({ name: modifier.name, group: modifier.groupName, price: modifier.price });
        continue;
      }
      const known = externalVariantId
        ? product.variants.find((candidate) => candidate.id === externalVariantId)
        : undefined;
      const name = (known?.name || variant.name || "").trim();
      if (name) variantNames.push(name);
    }

    lines.push({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku.slice(0, 50),
      quantity,
      unit_price: price,
      variant_name: variantNames.length > 0 ? variantNames.join(", ") : null,
      ...(modifiers.length > 0 ? { modifiers } : {}),
      notes: item.notes?.trim() || null,
      station: product.station,
    });
  }

  return { lines, unmapped };
}

/** Ringkasan order dari body event (utk kolom gofood_orders). */
export function summarizeGofoodOrder(event: GofoodWebhookEvent) {
  const order = event.body.order ?? {};
  return {
    gofood_order_id: String(order.order_number || "").trim(),
    gofood_order_type: gofoodOrderTypeFromServiceType(event.body.service_type),
    outlet_id: event.body.outlet?.id ?? null,
    order_total: Math.max(0, Math.round(Number(order.order_total) || 0)),
    currency: order.currency || "IDR",
    customer_name: event.body.customer?.name?.trim() || null,
    driver_name: event.body.driver?.name?.trim() || null,
    pin: order.pin ?? null,
    cutlery_requested: Boolean(order.cutlery_requested),
    takeaway_charges: Math.max(0, Math.round(Number(order.takeaway_charges) || 0)),
    cancel_reason: order.cancellation_detail?.reason?.trim() || null,
    items: order.order_items ?? [],
    created_at: order.created_at ?? event.header.timestamp ?? null,
  };
}

/** Catatan order POS supaya kasir/dapur langsung tahu ini GoFood. */
export function posOrderNotes(input: {
  gofood_order_id: string;
  gofood_order_type: GofoodOrderType;
  pin: string | null;
  customer_name: string | null;
  cutlery_requested: boolean;
  unmappedCount: number;
}) {
  const parts = [
    `GoFood ${input.gofood_order_id}`,
    input.gofood_order_type === "pickup" ? "Pickup" : "Delivery",
    input.pin ? `PIN ${input.pin}` : null,
    input.customer_name ? `Pelanggan: ${input.customer_name}` : null,
    input.cutlery_requested ? "Minta alat makan" : null,
    input.unmappedCount > 0 ? `${input.unmappedCount} item TIDAK terpetakan — cek halaman GoFood` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
