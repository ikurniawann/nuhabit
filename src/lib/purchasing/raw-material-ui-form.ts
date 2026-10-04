import { defaultPurchasePackFor } from "@/lib/purchasing/packs";
import type { RawMaterialFormData, RawMaterialUnitConversion, RawMaterialWithStock } from "@/types/purchasing";

/** State form tambah/ubah bahan baku. */
export interface RawMaterialFormState {
  kode: string;
  nama: string;
  kategori: string;
  deskripsi: string;
  satuan_besar_id: string;
  satuan_kecil_id: string | undefined;
  harga_beli: number;
  konversi_factor: number;
  stok_minimum: number;
  stok_maximum: number;
  shelf_life_days: number | undefined;
  coa_production: string;
  coa_rnd: string;
  coa_asset: string;
  /** Pack tambahan selain satuan besar/kecil. */
  unit_conversions: RawMaterialUnitConversion[];
}

export const EMPTY_RAW_MATERIAL_FORM: RawMaterialFormState = {
  kode: "",
  nama: "",
  kategori: "",
  deskripsi: "",
  satuan_besar_id: "",
  satuan_kecil_id: undefined,
  harga_beli: 0,
  konversi_factor: 1,
  stok_minimum: 0,
  stok_maximum: 0,
  shelf_life_days: undefined,
  coa_production: "",
  coa_rnd: "",
  coa_asset: "",
  unit_conversions: [],
};

/** Isi form dari bahan baku tersimpan; satuan besar/kecil dikeluarkan dari daftar pack tambahan. */
export function rawMaterialFormFromMaterial(data: RawMaterialWithStock): RawMaterialFormState {
  return {
    kode: data.kode || "",
    nama: data.nama || "",
    kategori: data.kategori || "",
    deskripsi: data.deskripsi || "",
    satuan_besar_id: data.satuan_besar_id || "",
    satuan_kecil_id: data.satuan_kecil_id || undefined,
    harga_beli: data.harga_beli || 0,
    konversi_factor: data.konversi_factor || 1,
    stok_minimum: data.stok_minimum || 0,
    stok_maximum: data.stok_maximum || 0,
    shelf_life_days: data.shelf_life_days || undefined,
    coa_production: data.coa_production || "",
    coa_rnd: data.coa_rnd || "",
    coa_asset: data.coa_asset || "",
    unit_conversions: (data.unit_conversions || []).filter(
      (conversion) =>
        conversion.satuan_id !== data.satuan_besar_id && conversion.satuan_id !== data.satuan_kecil_id
    ),
  };
}

/** Pack bawaan pembelian tersimpan, jatuh ke satuan besar. */
export function initialPurchasePackId(data: RawMaterialWithStock): string {
  return defaultPurchasePackFor(data)?.satuan_id ?? data.satuan_besar_id ?? "";
}

/** Satuan yang bisa jadi pack bawaan pembelian (unik, tanpa kosong). */
export function purchasePackUnitIds(form: RawMaterialFormState): string[] {
  return Array.from(
    new Set(
      [form.satuan_besar_id, form.satuan_kecil_id, ...form.unit_conversions.map((c) => c.satuan_id)].filter(
        (id): id is string => Boolean(id)
      )
    )
  );
}

/**
 * Payload API: COA kosong jadi null, pack tanpa satuan/qty dibuang. Satuan besar/kecil
 * disintesis ulang oleh API; baris `purchasePackId` hanya membawa flag pack bawaan.
 */
export function buildRawMaterialPayload(
  form: RawMaterialFormState,
  purchasePackId?: string
): RawMaterialFormData {
  const conversions: RawMaterialUnitConversion[] = form.unit_conversions
    .filter((conversion) => conversion.satuan_id && conversion.qty_in_base_unit > 0)
    .map((conversion) => ({
      satuan_id: conversion.satuan_id,
      qty_in_base_unit: conversion.qty_in_base_unit,
      is_base: false,
    }));
  if (purchasePackId) {
    conversions.push({ satuan_id: purchasePackId, qty_in_base_unit: 1, is_purchase_default: true });
  }
  return {
    ...form,
    coa_production: form.coa_production || null,
    coa_rnd: form.coa_rnd || null,
    coa_asset: form.coa_asset || null,
    unit_conversions: conversions,
  };
}
