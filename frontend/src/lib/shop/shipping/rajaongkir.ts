// EPIC-039 Fase C — adapter RajaOngkir (Komerce, https://rajaongkir.komerce.id).
// Kemampuan: cek tarif + cari tujuan + lacak resi. TIDAK ada pembuatan order
// pengiriman (bukan bagian API RajaOngkir) — resi diinput manual di
// manajemen pesanan (Fase E). Auth: header `key: <RAJAONGKIR_API_KEY>`.

import {
  type AreaSuggestion,
  type CreateShipmentResult,
  type RateQuote,
  type RateRequest,
  type ShippingProvider,
  type TrackingResult,
  ShippingProviderError,
  requireEnvKey,
} from "./types";

const BASE_URL = "https://rajaongkir.komerce.id/api/v1";

async function rajaongkirFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = requireEnvKey("RAJAONGKIR_API_KEY");
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      key: apiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as {
    meta?: { message?: string; status?: string; code?: number };
    data?: unknown;
  };
  const metaStatus = json.meta?.status?.toLowerCase();
  if (!response.ok || (metaStatus && metaStatus !== "success")) {
    const message = String(json.meta?.message || `RajaOngkir error HTTP ${response.status}`);
    throw new ShippingProviderError(`RajaOngkir: ${message}`);
  }
  return json as T;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

type RajaOngkirDestination = {
  id?: number | string;
  label?: string;
  subdistrict_name?: string;
  district_name?: string;
  city_name?: string;
  province_name?: string;
  zip_code?: string | null;
};

type RajaOngkirCost = {
  name?: string;
  code?: string;
  service?: string;
  description?: string;
  cost?: number;
  etd?: string;
};

export const rajaongkirProvider: ShippingProvider = {
  name: "rajaongkir",
  capabilities: { createShipment: false, trackingWebhook: false },

  async searchAreas(query: string): Promise<AreaSuggestion[]> {
    const params = new URLSearchParams({ search: query, limit: "15", offset: "0" });
    const json = await rajaongkirFetch<{ data?: RajaOngkirDestination[] }>(
      `/destination/domestic-destination?${params.toString()}`
    );
    return (json.data ?? [])
      .filter((row) => row.id !== undefined && row.id !== null)
      .map((row) => ({
        provider: "rajaongkir" as const,
        id: String(row.id),
        label:
          row.label ||
          [row.subdistrict_name, row.district_name, row.city_name, row.province_name]
            .filter(Boolean)
            .join(", "),
        postalCode: row.zip_code ? String(row.zip_code) : null,
      }));
  },

  async getRates(request: RateRequest): Promise<RateQuote[]> {
    // Komerce memakai form-urlencoded; kurir dipisah titik dua (jne:jnt:...)
    const body = new URLSearchParams({
      origin: request.originId,
      destination: request.destinationId,
      weight: String(Math.max(1, Math.round(request.weightGram))),
      courier: request.couriers.join(":"),
    });
    if (request.itemValue) body.set("item_value", String(Math.round(request.itemValue)));

    const json = await rajaongkirFetch<{ data?: RajaOngkirCost[] }>(
      "/calculate/domestic-cost",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );

    return (json.data ?? []).map((row) => ({
      provider: "rajaongkir" as const,
      courierCode: String(row.code || "").toLowerCase(),
      courierName: String(row.name || row.code || ""),
      serviceCode: String(row.service || ""),
      serviceName: String(row.description || row.service || ""),
      price: toNumber(row.cost),
      etd: row.etd ? String(row.etd) : null,
    }));
  },

  async getTracking(waybill: string, courierCode: string): Promise<TrackingResult> {
    const params = new URLSearchParams({ awb: waybill, courier: courierCode });
    const json = await rajaongkirFetch<{
      data?: {
        delivery_status?: { status?: string };
        manifest?: Array<{
          manifest_date?: string;
          manifest_time?: string;
          manifest_description?: string;
          city_name?: string;
        }>;
      };
    }>(`/track/waybill?${params.toString()}`, { method: "POST" });

    const status = json.data?.delivery_status?.status || "unknown";
    return {
      provider: "rajaongkir",
      waybill,
      courierCode,
      status: String(status),
      events: (json.data?.manifest ?? []).map((event) => ({
        time: [event.manifest_date, event.manifest_time].filter(Boolean).join(" ") || null,
        status: String(event.manifest_description || ""),
        note: event.city_name || null,
      })),
    };
  },

  async createShipment(): Promise<CreateShipmentResult> {
    throw new ShippingProviderError(
      "RajaOngkir tidak mendukung pembuatan order pengiriman — buat pengiriman di aplikasi kurir lalu input resi manual",
      400
    );
  },
};
