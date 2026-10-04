/**
 * Kemasan (pack) bahan baku — port domain/fmcg.go NüHabit.
 *
 * Stok selalu dihitung dalam satuan dasar (satuan kecil bila ada, selain itu
 * satuan besar). Pack = kelipatan bernama dari satuan dasar (karton isi 24,
 * dus isi 12), disimpan di item.raw_material_unit_conversions. Semua konversi
 * PO → GRN → stok lewat sini supaya tidak ada dua tempat yang mengalikan.
 */

import { roundQty } from "@/lib/inventory/batches";

export interface ItemPack {
  id?: string;
  satuan_id: string;
  /** Isi pack dalam satuan dasar. Pack dasar = 1. */
  qty_in_base_unit: number;
  is_base?: boolean;
  is_purchase_default?: boolean;
  is_issue_default?: boolean;
  is_active?: boolean;
  barcode?: string | null;
  unit_name?: string | null;
}

export type PackRejection =
  | "FACTOR_NOT_POSITIVE"
  | "BASE_FACTOR_NOT_ONE"
  | "UNIT_ALREADY_DEFINED"
  | "FRACTIONAL_COUNT";

function safeFactor(factor: number): number {
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

const isActive = (pack: ItemPack) => pack.is_active !== false;

/** 10 karton isi 24 = 240 satuan dasar. */
export function packToBase(packQty: number, factor: number): number {
  return roundQty(packQty * safeFactor(factor));
}

/** Kebalikannya, sengaja tidak dibulatkan ke pack utuh (3,5 karton itu informasi benar). */
export function baseToPack(baseQty: number, factor: number): number {
  return roundQty(baseQty / safeFactor(factor));
}

/** Harga per pack → harga per satuan dasar (yang dipakai biaya rata-rata). */
export function packPriceToBase(packPrice: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return packPrice;
  return Math.round((packPrice / factor) * 100) / 100;
}

/** "2 karton + 3 pcs" untuk daftar ambil barang. */
export function splitToPacks(baseQty: number, factor: number): { packs: number; remainder: number } {
  if (factor <= 1) return { packs: Math.trunc(baseQty), remainder: 0 };
  const whole = Math.floor(baseQty / factor);
  return { packs: whole, remainder: roundQty(baseQty - whole * factor) };
}

export function findPack(packs: ItemPack[], satuanId: string | null | undefined): ItemPack | undefined {
  if (!satuanId) return undefined;
  return packs.find((pack) => pack.satuan_id === satuanId && isActive(pack));
}

export function basePack(packs: ItemPack[]): ItemPack | undefined {
  return packs.find((pack) => pack.is_base && isActive(pack));
}

export function defaultPurchasePack(packs: ItemPack[]): ItemPack | undefined {
  return packs.find((pack) => pack.is_purchase_default && isActive(pack)) ?? basePack(packs);
}

export function defaultIssuePack(packs: ItemPack[]): ItemPack | undefined {
  return packs.find((pack) => pack.is_issue_default && isActive(pack)) ?? basePack(packs);
}

/** "KARTON (24 PCS)", atau nama satuan saja bila tidak ada konversi. */
export function packLabel(pack: ItemPack, baseUnitName: string): string {
  const name = pack.unit_name || "";
  if (pack.is_base || pack.qty_in_base_unit === 1) return name;
  const factor = String(roundQty(pack.qty_in_base_unit));
  return `${name} (${factor} ${baseUnitName})`;
}

/**
 * Validasi satu pack terhadap pack lain milik item yang sama: isi positif, pack
 * dasar berisi 1, satu satuan satu pack, dan satuan hitung berisi bilangan bulat.
 */
export function evaluatePack(
  existing: ItemPack[],
  candidate: ItemPack,
  unitKind: "count" | "measure" = "measure"
): PackRejection | null {
  const factor = candidate.qty_in_base_unit;
  if (!Number.isFinite(factor) || factor <= 0) return "FACTOR_NOT_POSITIVE";
  if (candidate.is_base && factor !== 1) return "BASE_FACTOR_NOT_ONE";
  if (unitKind === "count" && !Number.isInteger(factor)) return "FRACTIONAL_COUNT";
  const duplicate = existing.some(
    (pack) =>
      isActive(pack) &&
      pack.satuan_id === candidate.satuan_id &&
      (candidate.id === undefined || pack.id !== candidate.id)
  );
  return duplicate ? "UNIT_ALREADY_DEFINED" : null;
}

export interface LegacyUnitMaterial {
  satuan_besar_id?: string | null;
  satuan_kecil_id?: string | null;
  konversi_factor?: number | string | null;
}

/**
 * Satuan besar/kecil lama sebagai pack (sama dengan backfill migrasi
 * 20261004140000): satuan kecil = dasar, satuan besar = konversi_factor.
 * Dipakai saat bahan baku belum punya baris pack sendiri.
 */
export function legacyPacks(material: LegacyUnitMaterial): ItemPack[] {
  const big = material.satuan_besar_id || null;
  const small = material.satuan_kecil_id && material.satuan_kecil_id !== big ? material.satuan_kecil_id : null;
  const packs: ItemPack[] = [];
  if (small) {
    packs.push({ satuan_id: small, qty_in_base_unit: 1, is_base: true, is_issue_default: true });
  }
  if (big) {
    const factor = small ? safeFactor(Number(material.konversi_factor)) : 1;
    packs.push({
      satuan_id: big,
      qty_in_base_unit: factor,
      is_base: !small,
      is_purchase_default: true,
      is_issue_default: !small,
    });
  }
  return packs;
}

/** Pack milik item, jatuh ke satuan besar/kecil lama bila belum ada barisnya. */
export function resolvePacks(material: LegacyUnitMaterial, rows: ItemPack[] | null | undefined): ItemPack[] {
  const active = (rows || []).filter(isActive);
  if (active.length === 0) return legacyPacks(material);
  const known = new Set(active.map((pack) => pack.satuan_id));
  const missing = legacyPacks(material).filter((pack) => !known.has(pack.satuan_id));
  return [...active, ...missing.map((pack) => ({ ...pack, is_purchase_default: false, is_issue_default: false }))];
}

/**
 * Faktor satuan transaksi → satuan dasar. Satuan kosong/tidak dikenal jatuh ke
 * satuan besar lama (perilaku konversi GRN sebelum ada tabel pack).
 */
export function packFactor(
  material: LegacyUnitMaterial | null | undefined,
  rows: ItemPack[] | null | undefined,
  satuanId: string | null | undefined
): number {
  if (!material) return 1;
  const usable = (rows || []).filter((pack) => pack.qty_in_base_unit > 0);
  const pack = findPack(resolvePacks(material, usable), satuanId);
  if (pack) return pack.qty_in_base_unit;
  return legacyPacks(material).find((p) => p.is_purchase_default)?.qty_in_base_unit ?? 1;
}

/**
 * Pack beli bawaan sebuah bahan baku: pack bertanda bawaan, lalu satuan besar
 * (perilaku PO sebelum ada tabel pack), lalu pack dasar.
 */
export function defaultPurchasePackFor(
  material: LegacyUnitMaterial & { unit_conversions?: ItemPack[] | null }
): ItemPack | undefined {
  const packs = resolvePacks(material, material.unit_conversions);
  return (
    packs.find((pack) => pack.is_purchase_default && isActive(pack)) ??
    findPack(packs, material.satuan_besar_id) ??
    basePack(packs)
  );
}

/** Kebutuhan dalam satuan dasar → jumlah pack utuh yang dipesan (dibulatkan ke atas). */
export function wholePacksFor(baseQty: number, factor: number): number {
  if (!(baseQty > 0)) return 0;
  return Math.ceil(baseToPack(baseQty, factor));
}
