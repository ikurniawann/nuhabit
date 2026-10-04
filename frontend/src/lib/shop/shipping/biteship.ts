// EPIC-039 Fase C — adapter Biteship (https://api.biteship.com).
// Kemampuan penuh: cek tarif, cari area, buat pengiriman, tracking.
// Auth: header `authorization: <BITESHIP_API_KEY>` (env, JANGAN hardcode).

import {
  type AreaSuggestion,
  type CreateShipmentRequest,
  type CreateShipmentResult,
  type RateQuote,
  type RateRequest,
  type ShippingProvider,
  type TrackingResult,
  ShippingProviderError,
  requireEnvKey,
} from "./types";

const BASE_URL = "https://api.biteship.com";

async function biteshipFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = requireEnvKey("BITESHIP_API_KEY");
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: apiKey,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    success?: boolean;
    error?: string;
  };
  if (!response.ok || json.success === false) {
    const message = String(json.error || `Biteship error HTTP ${response.status}`);
    throw new ShippingProviderError(`Biteship: ${message}`);
  }
  return json as T;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

type BiteshipArea = {
  id?: string;
  name?: string;
  postal_code?: number | string | null;
};

type BiteshipPricing = {
  courier_code?: string;
  courier_name?: string;
  courier_service_code?: string;
  courier_service_name?: string;
  price?: number;
  duration?: string;
  shipment_duration_range?: string;
  shipment_duration_unit?: string;
};

export const biteshipProvider: ShippingProvider = {
  name: "biteship",
  capabilities: { createShipment: true, trackingWebhook: true },

  async searchAreas(query: string): Promise<AreaSuggestion[]> {
    const params = new URLSearchParams({
      countries: "ID",
      input: query,
      type: "single",
    });
    const json = await biteshipFetch<{ areas?: BiteshipArea[] }>(
      `/v1/maps/areas?${params.toString()}`
    );
    return (json.areas ?? [])
      .filter((area) => area.id && area.name)
      .map((area) => ({
        provider: "biteship" as const,
        id: String(area.id),
        label: String(area.name),
        postalCode: area.postal_code ? String(area.postal_code) : null,
      }));
  },

  async getRates(request: RateRequest): Promise<RateQuote[]> {
    const json = await biteshipFetch<{ pricing?: BiteshipPricing[] }>(
      "/v1/rates/couriers",
      {
        method: "POST",
        body: JSON.stringify({
          origin_area_id: request.originId,
          destination_area_id: request.destinationId,
          couriers: request.couriers.join(","),
          items: [
            {
              name: "Merchandise",
              value: toNumber(request.itemValue) || 0,
              weight: Math.max(1, Math.round(request.weightGram)),
              quantity: 1,
            },
          ],
        }),
      }
    );

    return (json.pricing ?? []).map((row) => ({
      provider: "biteship" as const,
      courierCode: String(row.courier_code || ""),
      courierName: String(row.courier_name || row.courier_code || ""),
      serviceCode: String(row.courier_service_code || ""),
      serviceName: String(row.courier_service_name || row.courier_service_code || ""),
      price: toNumber(row.price),
      etd:
        row.duration ||
        (row.shipment_duration_range
          ? `${row.shipment_duration_range} ${row.shipment_duration_unit || ""}`.trim()
          : null),
    }));
  },

  async getTracking(waybill: string, courierCode: string): Promise<TrackingResult> {
    const json = await biteshipFetch<{
      status?: string;
      history?: Array<{ updated_at?: string; status?: string; note?: string }>;
    }>(`/v1/trackings/${encodeURIComponent(waybill)}/couriers/${encodeURIComponent(courierCode)}`);

    return {
      provider: "biteship",
      waybill,
      courierCode,
      status: String(json.status || "unknown"),
      events: (json.history ?? []).map((event) => ({
        time: event.updated_at || null,
        status: String(event.status || ""),
        note: event.note || null,
      })),
    };
  },

  async createShipment(request: CreateShipmentRequest): Promise<CreateShipmentResult> {
    const json = await biteshipFetch<{
      id?: string;
      status?: string;
      price?: number;
      courier?: { waybill_id?: string | null };
    }>("/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        origin_contact_name: request.originContactName,
        origin_contact_phone: request.originContactPhone,
        origin_address: request.originAddress,
        origin_area_id: request.originId,
        destination_contact_name: request.destination.contactName,
        destination_contact_phone: request.destination.contactPhone,
        destination_address: request.destination.address,
        destination_area_id: request.destination.areaId,
        courier_company: request.courierCode,
        courier_type: request.serviceCode,
        delivery_type: "now",
        reference_id: request.referenceId,
        items: request.items.map((item) => ({
          name: item.name,
          value: item.value,
          weight: Math.max(1, Math.round(item.weightGram)),
          quantity: item.quantity,
        })),
      }),
    });

    if (!json.id) {
      throw new ShippingProviderError("Biteship: order pengiriman tidak mengembalikan id");
    }

    return {
      provider: "biteship",
      providerOrderId: String(json.id),
      waybill: json.courier?.waybill_id ?? null,
      price: toNumber(json.price),
      status: String(json.status || "confirmed"),
    };
  },
};
