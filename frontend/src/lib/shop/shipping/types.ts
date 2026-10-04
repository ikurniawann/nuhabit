// EPIC-039 Fase C — kontrak adapter kurir (keputusan owner: Biteship utama +
// RajaOngkir/Komerce alternatif; provider dipilih dari settings).
//
// Kemampuan per provider BERBEDA dan dinyatakan lewat `capabilities`:
//   - biteship  : rates + createShipment + tracking (webhook di Fase E)
//   - rajaongkir: rates + tracking by waybill (TANPA createShipment — resi
//                 diinput manual di manajemen pesanan)

import { ApiError } from "@/lib/api/auth";

export type ShippingProviderName = "biteship" | "rajaongkir";

export type RateQuote = {
  provider: ShippingProviderName;
  courierCode: string;
  courierName: string;
  serviceCode: string;
  serviceName: string;
  /** Tarif murni provider, SEBELUM markup toko */
  price: number;
  /** Estimasi sampai, teks apa adanya dari provider ("1-2 hari" dsb.) */
  etd: string | null;
};

export type AreaSuggestion = {
  provider: ShippingProviderName;
  /** id yang harus dikirim balik saat cek tarif (area_id/district id) */
  id: string;
  label: string;
  postalCode: string | null;
};

export type RateRequest = {
  /** id area/district asal sesuai provider aktif */
  originId: string;
  originPostalCode?: string | null;
  /** id area/district tujuan sesuai provider aktif */
  destinationId: string;
  destinationPostalCode?: string | null;
  weightGram: number;
  /** Nilai barang (asuransi/COD provider tertentu) */
  itemValue?: number;
  /** Daftar kode kurir yang diaktifkan di settings (jne, jnt, sicepat, ...) */
  couriers: string[];
};

export type TrackingEvent = {
  time: string | null;
  status: string;
  note: string | null;
};

export type TrackingResult = {
  provider: ShippingProviderName;
  waybill: string;
  courierCode: string;
  status: string;
  events: TrackingEvent[];
};

export type CreateShipmentRequest = {
  originId: string;
  originContactName: string;
  originContactPhone: string;
  originAddress: string;
  destination: {
    areaId: string;
    contactName: string;
    contactPhone: string;
    address: string;
    postalCode?: string | null;
  };
  courierCode: string;
  serviceCode: string;
  items: Array<{ name: string; value: number; weightGram: number; quantity: number }>;
  /** Referensi order internal (nomor order shop) */
  referenceId: string;
};

export type CreateShipmentResult = {
  provider: ShippingProviderName;
  providerOrderId: string;
  waybill: string | null;
  price: number;
  status: string;
};

export interface ShippingProvider {
  name: ShippingProviderName;
  capabilities: {
    createShipment: boolean;
    trackingWebhook: boolean;
  };
  searchAreas(query: string): Promise<AreaSuggestion[]>;
  getRates(request: RateRequest): Promise<RateQuote[]>;
  getTracking(waybill: string, courierCode: string): Promise<TrackingResult>;
  /** Provider tanpa dukungan (RajaOngkir) melempar error yang jelas */
  createShipment(request: CreateShipmentRequest): Promise<CreateShipmentResult>;
}

/** Galat provider kurir = ApiError (default 502) supaya apiHandler meneruskan status & pesannya. */
export class ShippingProviderError extends ApiError {
  constructor(message: string, status = 502) {
    super(status, message);
    this.name = "ShippingProviderError";
  }
}

export function requireEnvKey(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ShippingProviderError(
      `${name} belum dikonfigurasi di environment server`,
      503
    );
  }
  return value;
}
