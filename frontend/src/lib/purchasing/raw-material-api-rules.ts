// Aturan murni API master bahan baku: skema body, normalisasi COA, rencana
// konversi satuan/pack, ringkasan status stok dan riwayat harga.
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import {
  deriveLegacyCoaEnum,
  resolveDefaultCoaForCategory,
} from "@/lib/purchasing/raw-material-coa";

/** Normalisasi kode akun: "1 3 01 001" / "1-301-001" → "1301001"; selain 7 digit → null. */
export function normalizeCoaAccountCode(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).trim().replace(/[\s\-_.]/g, "");
  if (!/^\d{7}$/.test(digits)) return null;
  return digits;
}

/** Nama field lama (kode_bahan / nama_bahan) dan string kosong → null. */
export function prepareMaterialBody(body: unknown): Record<string, unknown> {
  const next: Record<string, unknown> =
    body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  if (next.kode == null && typeof next.kode_bahan === "string") next.kode = next.kode_bahan;
  if (next.nama == null && typeof next.nama_bahan === "string") next.nama = next.nama_bahan;
  for (const key of [
    "kode",
    "deskripsi",
    "satuan_kecil_id",
    "storage_condition",
    "coa_production",
    "coa_rnd",
    "coa_asset",
  ] as const) {
    if (next[key] === "") next[key] = null;
  }
  return next;
}

const coaAccountCode = z
  .string()
  .max(20)
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value == null || value === "") return null;
    const code = normalizeCoaAccountCode(value);
    if (!code) {
      ctx.addIssue({
        code: "custom",
        message: "Kode Chart of Accounts tidak valid (gunakan 7 digit, mis. 1301001)",
      });
      return z.NEVER;
    }
    return code;
  });

const coaEnum = z.enum(["PRODUCTION", "RND", "ASSET"]);

export const rawMaterialCreateSchema = z.object({
  kode: z.string().max(20).optional().nullable(),
  nama: z.string().min(1, "Material name is required").max(100),
  kategori: z.string().min(1, "Category is required").max(30),
  deskripsi: z.string().optional().nullable(),
  satuan_besar_id: z.string().uuid("Large unit is required"),
  satuan_kecil_id: z.string().uuid().optional().nullable(),
  harga_beli: z.number().min(0).default(0),
  konversi_factor: z.number().min(0).default(1),
  stok_minimum: z.number().min(0).default(0),
  stok_maximum: z.number().min(0).default(0),
  shelf_life_days: z.number().min(0).optional().nullable(),
  storage_condition: z.string().max(20).optional().nullable(),
  coa: coaEnum.optional().nullable(),
  coa_production: coaAccountCode,
  coa_rnd: coaAccountCode,
  coa_asset: coaAccountCode,
  unit_conversions: z
    .array(
      z.object({
        satuan_id: z.string().uuid(),
        qty_in_base_unit: z.number().min(0.000001),
        is_base: z.boolean().optional(),
      })
    )
    .optional()
    .default([]),
});

export type RawMaterialCreateInput = z.infer<typeof rawMaterialCreateSchema>;

export const rawMaterialUpdateSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  kategori: z.string().min(1).max(30).optional(),
  deskripsi: z.string().optional(),
  satuan_besar_id: z.string().uuid().optional().nullable(),
  satuan_kecil_id: z.string().uuid().optional().nullable(),
  harga_beli: z.number().min(0).optional(),
  konversi_factor: z.number().min(0).optional(),
  stok_minimum: z.number().min(0).optional(),
  stok_maximum: z.number().min(0).optional(),
  shelf_life_days: z.number().min(0).optional().nullable(),
  storage_condition: z.string().max(20).optional().nullable(),
  is_active: z.boolean().optional(),
  coa: coaEnum.optional().nullable(),
  coa_production: coaAccountCode,
  coa_rnd: coaAccountCode,
  coa_asset: coaAccountCode,
  unit_conversions: z
    .array(
      z.object({
        satuan_id: z.string().uuid(),
        qty_in_base_unit: z.number().min(0.000001),
        is_base: z.boolean().optional(),
        // Pack: bawaan baris PO / pengeluaran stok, dan barcode kemasan.
        is_purchase_default: z.boolean().optional(),
        is_issue_default: z.boolean().optional(),
        barcode: z.string().trim().max(64).optional().nullable(),
      })
    )
    .optional(),
});

export type RawMaterialUpdateInput = z.infer<typeof rawMaterialUpdateSchema>;

type CoaCode = string | null;
type CoaEnum = z.infer<typeof coaEnum>;

/** COA bahan baru: kode kosong diisi default kategori; enum lama diturunkan dari kode. */
export function resolveCreateCoa(input: RawMaterialCreateInput) {
  const defaults = resolveDefaultCoaForCategory(input.kategori);
  const coa_production = input.coa_production ?? defaults.coa_production;
  const coa_rnd = input.coa_rnd ?? null;
  const coa_asset = input.coa_asset ?? defaults.coa_asset;
  const coa = input.coa ?? deriveLegacyCoaEnum({ coa_production, coa_rnd, coa_asset });
  return { coa, coa_production, coa_rnd, coa_asset };
}

/** Enum COA saat update: eksplisit menang, selain itu diturunkan dari kode terbaru. */
export function resolveUpdateCoa(
  input: Partial<Pick<RawMaterialUpdateInput, "coa" | "coa_production" | "coa_rnd" | "coa_asset">>,
  existing: { coa?: CoaEnum | null; coa_production?: CoaCode; coa_rnd?: CoaCode; coa_asset?: CoaCode }
): CoaEnum | null | undefined {
  if (input.coa !== undefined) return input.coa;
  return (
    deriveLegacyCoaEnum({
      coa_production:
        input.coa_production !== undefined ? input.coa_production : existing.coa_production,
      coa_rnd: input.coa_rnd !== undefined ? input.coa_rnd : existing.coa_rnd,
      coa_asset: input.coa_asset !== undefined ? input.coa_asset : existing.coa_asset,
    }) ?? existing.coa
  );
}

export interface PlannedConversion {
  satuan_id: string;
  qty_in_base_unit: number | string;
  is_base: boolean;
  is_purchase_default?: boolean;
  is_issue_default?: boolean;
  barcode?: string | null;
}

interface MaterialUnits {
  satuan_besar_id?: string | null;
  satuan_kecil_id?: string | null;
  konversi_factor?: number | string | null;
}

/**
 * Konversi aktif setelah simpan: satuan kecil (basis), satuan besar (× konversi
 * atau basis bila tak ada satuan kecil), lalu pack dari payload. Satuan
 * besar/kecil menang atas isi pack; atribut pack (bawaan, barcode) dari payload
 * tetap ikut.
 */
export function planUnitConversions(
  material: MaterialUnits,
  packs: ReadonlyArray<Omit<PlannedConversion, "is_base"> & { is_base?: boolean }>
): PlannedConversion[] {
  const conversions: PlannedConversion[] = [
    ...(material.satuan_kecil_id
      ? [{ satuan_id: material.satuan_kecil_id, qty_in_base_unit: 1, is_base: true }]
      : []),
    ...(material.satuan_besar_id
      ? [
          {
            satuan_id: material.satuan_besar_id,
            qty_in_base_unit: material.satuan_kecil_id ? material.konversi_factor || 1 : 1,
            is_base: !material.satuan_kecil_id,
          },
        ]
      : []),
    ...packs.map((pack) => ({ ...pack, is_base: pack.is_base ?? false })),
  ];
  const byUnit = new Map<string, PlannedConversion>();
  for (const conversion of conversions) {
    const existing = byUnit.get(conversion.satuan_id);
    byUnit.set(conversion.satuan_id, existing ? { ...conversion, ...existing } : conversion);
  }
  return Array.from(byUnit.values());
}

export const PACK_DEFAULT_FLAGS = ["is_purchase_default", "is_issue_default"] as const;
export type PackDefaultFlag = (typeof PACK_DEFAULT_FLAGS)[number];

/** Flag bawaan yang dipakai payload; lempar 400 bila satu flag dipasang di >1 pack. */
export function packDefaultFlagsToReset(
  packs: ReadonlyArray<Partial<Record<PackDefaultFlag, boolean>>>
): PackDefaultFlag[] {
  return PACK_DEFAULT_FLAGS.filter((key) => {
    const flagged = packs.filter((pack) => pack[key]).length;
    if (flagged > 1) {
      throw ApiError.badRequest(
        "Hanya satu pack yang boleh menjadi bawaan pembelian/pengeluaran"
      );
    }
    return flagged === 1;
  });
}

/** Baris upsert konversi saat update: flag/barcode hanya ditulis bila dikirim. */
export function conversionUpdateRow(
  rawMaterialId: string,
  conversion: PlannedConversion,
  now: string
): Record<string, unknown> {
  return {
    raw_material_id: rawMaterialId,
    satuan_id: conversion.satuan_id,
    qty_in_base_unit: conversion.qty_in_base_unit,
    is_base: conversion.is_base,
    is_active: true,
    ...("is_purchase_default" in conversion
      ? { is_purchase_default: Boolean(conversion.is_purchase_default) }
      : {}),
    ...("is_issue_default" in conversion
      ? { is_issue_default: Boolean(conversion.is_issue_default) }
      : {}),
    ...("barcode" in conversion ? { barcode: conversion.barcode || null } : {}),
    updated_at: now,
  };
}

export interface StockStatusSummary {
  total: number;
  aman: number;
  menipis: number;
  habis: number;
}

/** Kartu KPI: status_stok kosong dihitung AMAN. */
export function summarizeStockStatus(
  rows: ReadonlyArray<{ status_stok?: string | null }>
): StockStatusSummary {
  const summary = { total: 0, aman: 0, menipis: 0, habis: 0 };
  for (const row of rows) {
    summary.total += 1;
    const status = String(row.status_stok || "AMAN");
    if (status === "MENIPIS") summary.menipis += 1;
    else if (status === "HABIS") summary.habis += 1;
    else summary.aman += 1;
  }
  return summary;
}

/** Ringkasan harga beli: urutan biaya terbaru dulu. */
export function summarizePurchaseCosts(costValues: readonly number[], months: number) {
  const count = costValues.length;
  return {
    months,
    purchase_count: count,
    last_cost: costValues[0] ?? null,
    min_cost: count > 0 ? Math.min(...costValues) : null,
    max_cost: count > 0 ? Math.max(...costValues) : null,
    avg_cost: count > 0 ? costValues.reduce((sum, value) => sum + value, 0) / count : null,
  };
}
