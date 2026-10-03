import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";
import { packFactor } from "@/lib/purchasing/packs";

export type BaseUnitMaterial = {
  satuan_besar_id?: string | null;
  satuan_kecil_id?: string | null;
  konversi_factor?: number | null;
};

export type BaseUnitConversion = {
  satuan_id: string;
  qty_in_base_unit?: number | null;
  is_base?: boolean | null;
  is_purchase_default?: boolean | null;
};

export type BaseUnitResolver = (
  rawMaterialId: string,
  satuanId?: string | null
) => number;

/**
 * Inventory stores quantity and unit cost in the material base unit (satuan kecil
 * when defined, otherwise satuan besar). Purchasing documents may transact in any
 * pack (item.raw_material_unit_conversions), so quantities are scaled through
 * packFactor before they are posted to stock.
 */
export function resolveBaseUnitFactor(
  material: BaseUnitMaterial | null | undefined,
  conversions: BaseUnitConversion[] | null | undefined,
  satuanId?: string | null
): number {
  const packs = (conversions || []).map((conversion) => ({
    satuan_id: conversion.satuan_id,
    qty_in_base_unit: toQty(conversion.qty_in_base_unit),
    is_base: Boolean(conversion.is_base),
    is_purchase_default: Boolean(conversion.is_purchase_default),
  }));
  return packFactor(material, packs, satuanId);
}

/**
 * Builds a resolver that converts a purchasing transaction unit into the material
 * base unit used by the inventory ledger.
 */
export async function createBaseUnitResolver(
  db: DbClient,
  rawMaterialIds: (string | null | undefined)[]
): Promise<BaseUnitResolver> {
  const ids = Array.from(new Set(rawMaterialIds.filter(Boolean) as string[]));
  if (ids.length === 0) return () => 1;

  const [{ data: materials }, { data: conversions }] = await Promise.all([
    db
      .from("raw_materials")
      .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor")
      .in("id", ids),
    db
      .from("raw_material_unit_conversions")
      .select("raw_material_id, satuan_id, qty_in_base_unit, is_base, is_purchase_default")
      .in("raw_material_id", ids)
      .eq("is_active", true),
  ]);

  const materialMap = new Map<string, BaseUnitMaterial>(
    ((materials || []) as (BaseUnitMaterial & { id: string })[]).map((material) => [
      material.id,
      material,
    ])
  );

  const conversionMap = new Map<string, BaseUnitConversion[]>();
  for (const conversion of (conversions || []) as (BaseUnitConversion & {
    raw_material_id: string;
  })[]) {
    const list = conversionMap.get(conversion.raw_material_id) || [];
    list.push(conversion);
    conversionMap.set(conversion.raw_material_id, list);
  }

  return (rawMaterialId, satuanId) =>
    resolveBaseUnitFactor(
      materialMap.get(rawMaterialId),
      conversionMap.get(rawMaterialId),
      satuanId
    );
}
