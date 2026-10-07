// EPIC-039 Fase C — resolver provider kurir + akses settings pengiriman.

import { createPgClient } from "@/lib/pg/create-client";
import type { DbClient } from "@/lib/pg/types";
import { biteshipProvider } from "./biteship";
import { rajaongkirProvider } from "./rajaongkir";
import type { RateQuote, ShippingProvider, ShippingProviderName } from "./types";

export * from "./types";
export * from "./quotes";

const PROVIDERS: Record<ShippingProviderName, ShippingProvider> = {
  biteship: biteshipProvider,
  rajaongkir: rajaongkirProvider,
};

export function resolveShippingProvider(name: string | null | undefined): ShippingProvider {
  const key = String(name || "biteship").toLowerCase() as ShippingProviderName;
  return PROVIDERS[key] ?? biteshipProvider;
}

export type ShippingSettings = {
  id: string;
  provider: ShippingProviderName;
  origin_area_id: string | null;
  origin_district_id: string | null;
  origin_label: string | null;
  origin_postal_code: string | null;
  origin_address: string | null;
  origin_contact_name: string | null;
  origin_contact_phone: string | null;
  couriers: string;
  markup_amount: number;
  is_active: boolean;
};

export const DEFAULT_COURIERS = "jne,jnt,sicepat";

/** Ambil (atau buat) baris settings pengiriman global. */
export async function getOrCreateShippingSettings(db: DbClient): Promise<ShippingSettings> {
  const { data: existing, error } = await db
    .from("shipping_settings", "shop")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing as ShippingSettings;

  const { data: created, error: createError } = await db
    .from("shipping_settings", "shop")
    .insert({ provider: "biteship", couriers: DEFAULT_COURIERS })
    .select("*")
    .single();
  if (createError || !created) {
    throw new Error(createError?.message || "Gagal menyiapkan settings pengiriman");
  }
  return created as ShippingSettings;
}

/** id origin sesuai provider aktif (biteship=area, rajaongkir=district). */
export function resolveOriginId(settings: ShippingSettings): string | null {
  return settings.provider === "rajaongkir"
    ? settings.origin_district_id
    : settings.origin_area_id;
}

export function parseCourierList(value: string | null | undefined): string[] {
  return String(value || DEFAULT_COURIERS)
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

/** Settings aktif + provider + origin + markup: titik awal semua route ongkir. */
export async function loadShippingContext(db: DbClient = createPgClient()) {
  const settings = await getOrCreateShippingSettings(db);
  return {
    settings,
    provider: resolveShippingProvider(settings.provider),
    originId: resolveOriginId(settings),
    markup: Number(settings.markup_amount) || 0,
  };
}

export type ShippingContext = Awaited<ReturnType<typeof loadShippingContext>>;

/** Tarif dari origin toko ke tujuan, dengan kurir aktif di settings. */
export function quoteFromOrigin(
  context: ShippingContext,
  originId: string,
  destination: { id: string; postalCode: string | null },
  cargo: { weightGram: number; itemValue: number }
): Promise<RateQuote[]> {
  return context.provider.getRates({
    originId,
    originPostalCode: context.settings.origin_postal_code,
    destinationId: destination.id,
    destinationPostalCode: destination.postalCode,
    weightGram: cargo.weightGram,
    itemValue: cargo.itemValue,
    couriers: parseCourierList(context.settings.couriers),
  });
}
