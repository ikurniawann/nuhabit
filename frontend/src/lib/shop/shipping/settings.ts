// Settings → Pengiriman: validasi patch (murni) + simpan.

import { ApiError } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { getOrCreateShippingSettings, parseCourierList, type ShippingSettings } from "./index";

const TEXT_FIELDS = [
  "origin_area_id",
  "origin_district_id",
  "origin_label",
  "origin_postal_code",
  "origin_address",
  "origin_contact_name",
  "origin_contact_phone",
] as const;

export type ShippingSettingsPatch = Record<string, string | number | null>;

/** Ambil field yang dikirim saja; nilai tidak valid → ApiError 400 dengan pesan untuk admin. */
export function buildShippingSettingsPatch(body: Record<string, unknown>): ShippingSettingsPatch {
  const patch: ShippingSettingsPatch = {};

  if (body.provider !== undefined) {
    const provider = String(body.provider).toLowerCase();
    if (provider !== "biteship" && provider !== "rajaongkir") {
      throw ApiError.badRequest("Provider harus biteship atau rajaongkir");
    }
    patch.provider = provider;
  }

  for (const key of TEXT_FIELDS) {
    if (body[key] !== undefined) patch[key] = body[key] ? String(body[key]) : null;
  }

  if (body.couriers !== undefined) {
    const couriers = parseCourierList(String(body.couriers || ""));
    if (couriers.length === 0) throw ApiError.badRequest("Minimal satu kurir harus aktif");
    patch.couriers = couriers.join(",");
  }

  if (body.markup_amount !== undefined) {
    const markup = Number(body.markup_amount);
    if (!Number.isFinite(markup) || markup < 0) throw ApiError.badRequest("Markup harus angka ≥ 0");
    patch.markup_amount = markup;
  }

  if (Object.keys(patch).length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
  return patch;
}

export async function updateShippingSettings(
  patch: ShippingSettingsPatch,
  userId: string
): Promise<ShippingSettings> {
  const db = createPgClient();
  const settings = await getOrCreateShippingSettings(db);
  const { data, error } = await db
    .from("shipping_settings", "shop")
    .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", settings.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ShippingSettings;
}
