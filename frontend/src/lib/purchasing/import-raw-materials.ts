/**
 * Impor bahan baku (POST /api/purchasing/import/raw-materials): kode yang sudah
 * ada di company/branch ini di-update (stok diset ke nilai file), kode baru
 * di-insert (stok awal ditambahkan). Satu baris gagal tidak menghentikan baris lain.
 */
import { queryOne } from "@/lib/db";
import { addOpeningStockFromImport, setStockFromImport } from "@/lib/inventory";
import type { DbClient } from "@/lib/pg/types";
import { exactScope, resolveWarehouseIdByCode } from "@/lib/purchasing/import-lookups";
import {
  ImportTally,
  nextCodeSequence,
  parseActiveCell,
  parseNumberCell,
  parseOptionalIntCell,
  type ImportRow,
} from "@/lib/purchasing/import-spreadsheet";

const VALID_COA = new Set(["PRODUCTION", "RND", "ASSET"]);

/** Header sudah dinormalisasi lewat alias raw-material-spreadsheet. */
export type RawMaterialSheetFields = {
  nama: string;
  kategori: string;
  satuanBesarKode: string;
  satuanKecilKode: string;
  warehouseCode: string;
  coaRaw: string;
  coa: string | null;
  konversiFactor: number;
  hargaBeli: number;
  hasStockValue: boolean;
  stockQty: number;
  payload: {
    deskripsi: string | null;
    stok_minimum: number;
    stok_maximum: number;
    shelf_life_days: number | null;
    is_active: boolean;
  };
};

export function readRawMaterialRow(data: Record<string, string>): RawMaterialSheetFields {
  const coaRaw = data.coa?.trim() ?? "";
  const stockCell = data.opening_stock;
  return {
    nama: data.nama?.trim() ?? "",
    kategori: data.kategori?.trim() ?? "",
    satuanBesarKode: data.satuan_besar_kode?.trim() ?? "",
    satuanKecilKode: data.satuan_kecil_kode?.trim() ?? "",
    warehouseCode: data.stall_code?.trim() ?? "",
    coaRaw,
    coa: coaRaw && VALID_COA.has(coaRaw.toUpperCase()) ? coaRaw.toUpperCase() : null,
    konversiFactor: parseNumberCell(data.konversi_factor, 1),
    hargaBeli: parseNumberCell(data.harga_beli, 0),
    hasStockValue: stockCell !== undefined && stockCell.trim() !== "",
    stockQty: parseNumberCell(stockCell, 0),
    payload: {
      deskripsi: data.deskripsi?.trim() || null,
      stok_minimum: parseNumberCell(data.stok_minimum, 0),
      stok_maximum: parseNumberCell(data.stok_maximum, 0),
      shelf_life_days: parseOptionalIntCell(data.shelf_life_days),
      is_active: parseActiveCell(data.status),
    },
  };
}

export function missingRawMaterialFields(fields: RawMaterialSheetFields): string[] {
  const missing: string[] = [];
  if (!fields.nama) missing.push("nama");
  if (!fields.satuanBesarKode) missing.push("satuan_besar_kode");
  if (!fields.kategori) missing.push("kategori");
  return missing;
}

export function normalizeKategori(value: string): string {
  return (value || "LAIN").trim().toUpperCase().replace(/\s+/g, "_");
}

/** Harga beli per satuan besar → biaya per satuan stok (satuan kecil bila ada). */
export function unitCostForStock(hargaBeli: number, konversiFactor: number, hasSmallUnit: boolean): number {
  if (!hasSmallUnit || konversiFactor <= 0) return hargaBeli;
  return hargaBeli / konversiFactor;
}

/** Baris raw_material_unit_conversions: satuan kecil = basis (1), satuan besar = faktor konversi. */
export function buildUnitConversions(material: {
  satuan_besar_id: string;
  satuan_kecil_id: string | null;
  konversi_factor: number;
}) {
  const conversions = [
    ...(material.satuan_kecil_id
      ? [{ satuan_id: material.satuan_kecil_id, qty_in_base_unit: 1, is_base: true }]
      : []),
    {
      satuan_id: material.satuan_besar_id,
      qty_in_base_unit: material.satuan_kecil_id ? material.konversi_factor || 1 : 1,
      is_base: !material.satuan_kecil_id,
    },
  ];
  const byUnit = new Map<string, (typeof conversions)[number]>();
  for (const conversion of conversions) {
    if (!byUnit.has(conversion.satuan_id)) byUnit.set(conversion.satuan_id, conversion);
  }
  return Array.from(byUnit.values());
}

type Context = {
  db: DbClient;
  userId: string;
  companyId: string | null;
  branchId: string | null;
  unitCache: Map<string, string | null>;
  warehouseCache: Map<string, string | null>;
  categoryCache: Map<string, boolean>;
};

type SavedMaterial = {
  id: string;
  satuan_besar_id: string;
  satuan_kecil_id: string | null;
  konversi_factor: number;
};

/** Pesan galat per jalur; jalur update (kode sudah ada) memakai teks Inggris sejak awal. */
const MESSAGES = {
  update: {
    largeUnit: (code: string) => `Large unit "${code}" not found. Import units first.`,
    smallUnit: (code: string) => `Small unit "${code}" not found`,
    coa: "COA must be PRODUCTION, RND, or ASSET",
  },
  insert: {
    largeUnit: (code: string) => `Satuan besar "${code}" tidak ditemukan. Import satuan terlebih dahulu.`,
    smallUnit: (code: string) => `Satuan kecil "${code}" tidak ditemukan`,
    coa: "COA harus PRODUCTION, RND, atau ASSET",
  },
};

/** Master kategori milik company dulu, lalu template global (company_id NULL). */
async function resolveCategoryCode(code: string, ctx: Context): Promise<string | null> {
  const normalized = normalizeKategori(code);
  const cacheKey = `${ctx.companyId || "*"}:${normalized}`;
  if (!ctx.categoryCache.has(cacheKey)) {
    const row = await queryOne<{ code: string }>(
      `SELECT code
       FROM item.raw_material_categories
       WHERE deleted_at IS NULL
         AND is_active = true
         AND upper(code) = upper($1)
         ${ctx.companyId ? "AND (company_id = $2 OR company_id IS NULL)" : ""}
       ORDER BY company_id NULLS LAST
       LIMIT 1`,
      ctx.companyId ? [normalized, ctx.companyId] : [normalized]
    );
    ctx.categoryCache.set(cacheKey, Boolean(row?.code));
  }
  return ctx.categoryCache.get(cacheKey) ? normalized : null;
}

/** Satuan milik company dulu, lalu template global. */
async function resolveUnitId(code: string, ctx: Context): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  const cacheKey = `${ctx.companyId || "*"}:${normalized}`;
  if (!ctx.unitCache.has(cacheKey)) {
    const row = await queryOne<{ id: string }>(
      `SELECT id
       FROM item.units
       WHERE deleted_at IS NULL
         AND upper(kode) = upper($1)
         ${ctx.companyId ? "AND (company_id = $2 OR company_id IS NULL)" : ""}
       ORDER BY company_id NULLS LAST
       LIMIT 1`,
      ctx.companyId ? [normalized, ctx.companyId] : [normalized]
    );
    ctx.unitCache.set(cacheKey, row?.id ?? null);
  }
  return ctx.unitCache.get(cacheKey) ?? null;
}

/** BHN-YYYY-#### berikutnya di company/branch ini. */
async function generateKode(ctx: Context): Promise<string> {
  const year = new Date().getFullYear();
  const query = ctx.db
    .from("raw_materials")
    .select("kode")
    .ilike("kode", `BHN-${year}-%`)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1);
  const { data: last } = await exactScope(query, ctx.companyId, ctx.branchId).maybeSingle();
  return `BHN-${year}-${String(nextCodeSequence(last?.kode)).padStart(4, "0")}`;
}

/** Satuan, COA, gudang → id; string = pesan galat baris. */
async function resolveReferences(
  fields: RawMaterialSheetFields,
  ctx: Context,
  messages: (typeof MESSAGES)["update"]
): Promise<
  | string
  | { satuanBesarId: string; satuanKecilId: string | null; warehouseId: string | null }
> {
  const satuanBesarId = await resolveUnitId(fields.satuanBesarKode, ctx);
  if (!satuanBesarId) return messages.largeUnit(fields.satuanBesarKode);

  let satuanKecilId: string | null = null;
  if (fields.satuanKecilKode) {
    satuanKecilId = await resolveUnitId(fields.satuanKecilKode, ctx);
    if (!satuanKecilId) return messages.smallUnit(fields.satuanKecilKode);
  }

  if (fields.coaRaw && !fields.coa) return messages.coa;

  let warehouseId: string | null = null;
  if (fields.warehouseCode) {
    warehouseId = await resolveWarehouseIdByCode(ctx.db, fields.warehouseCode, ctx.branchId, ctx.warehouseCache);
    if (!warehouseId) return `Stall code "${fields.warehouseCode}" was not found for this branch`;
  }
  return { satuanBesarId, satuanKecilId, warehouseId };
}

async function upsertUnitConversions(db: DbClient, material: SavedMaterial) {
  const conversions = buildUnitConversions(material);
  const { error } = await db.from("raw_material_unit_conversions").upsert(
    conversions.map((conversion) => ({
      raw_material_id: material.id,
      ...conversion,
      is_active: true,
    })),
    { onConflict: "raw_material_id,satuan_id" }
  );
  return error;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function updateExisting(
  row: ImportRow,
  existingId: string,
  kode: string,
  kategori: string,
  fields: RawMaterialSheetFields,
  ctx: Context,
  tally: ImportTally
): Promise<void> {
  const refs = await resolveReferences(fields, ctx, MESSAGES.update);
  if (typeof refs === "string") return tally.skip(row.rowNumber, refs);

  const { data: saved, error } = await ctx.db
    .from("raw_materials")
    .update({
      nama: fields.nama,
      kategori,
      deskripsi: fields.payload.deskripsi,
      satuan_besar_id: refs.satuanBesarId,
      satuan_kecil_id: refs.satuanKecilId,
      konversi_factor: fields.konversiFactor,
      stok_minimum: fields.payload.stok_minimum,
      stok_maximum: fields.payload.stok_maximum,
      shelf_life_days: fields.payload.shelf_life_days,
      coa: fields.coa,
      harga_beli: fields.hargaBeli,
      is_active: fields.payload.is_active,
    })
    .eq("id", existingId)
    .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor")
    .single();
  if (error || !saved) return tally.skip(row.rowNumber, error?.message || "Failed to update row");

  const conversionError = await upsertUnitConversions(ctx.db, saved);
  if (conversionError) return tally.skip(row.rowNumber, conversionError.message);

  if (fields.hasStockValue) {
    if (fields.stockQty < 0) return tally.skip(row.rowNumber, "Opening stock cannot be negative");
    try {
      await setStockFromImport(ctx.db, {
        rawMaterialId: saved.id,
        qtyActual: fields.stockQty,
        unitCost: unitCostForStock(fields.hargaBeli, fields.konversiFactor, Boolean(refs.satuanKecilId)),
        userId: ctx.userId,
        warehouseId: refs.warehouseId,
        materialKode: kode,
      });
    } catch (stockError) {
      return tally.skip(row.rowNumber, errorMessage(stockError, "Failed to update stock"));
    }
  }
  tally.updated += 1;
}

async function insertNew(
  row: ImportRow,
  kode: string,
  kategori: string,
  fields: RawMaterialSheetFields,
  ctx: Context,
  tally: ImportTally
): Promise<void> {
  const refs = await resolveReferences(fields, ctx, MESSAGES.insert);
  if (typeof refs === "string") return tally.skip(row.rowNumber, refs);
  if (fields.stockQty < 0) return tally.skip(row.rowNumber, "Opening stock cannot be negative");

  const { data: created, error } = await ctx.db
    .from("raw_materials")
    .insert({
      kode,
      nama: fields.nama,
      kategori,
      deskripsi: fields.payload.deskripsi,
      satuan_besar_id: refs.satuanBesarId,
      satuan_kecil_id: refs.satuanKecilId,
      konversi_factor: fields.konversiFactor,
      stok_minimum: fields.payload.stok_minimum,
      stok_maximum: fields.payload.stok_maximum,
      shelf_life_days: fields.payload.shelf_life_days,
      coa: fields.coa,
      harga_beli: fields.hargaBeli,
      company_id: ctx.companyId,
      branch_id: ctx.branchId,
      is_active: fields.payload.is_active,
    })
    .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor")
    .single();
  if (error || !created) return tally.skip(row.rowNumber, error?.message || "Gagal menyimpan data");

  // Gagal setelah insert → hapus lagi supaya baris bisa diimpor ulang.
  const conversionError = await upsertUnitConversions(ctx.db, created);
  if (conversionError) {
    await ctx.db.from("raw_materials").delete().eq("id", created.id);
    return tally.skip(row.rowNumber, conversionError.message);
  }

  if (fields.stockQty > 0) {
    try {
      await addOpeningStockFromImport(ctx.db, {
        rawMaterialId: created.id,
        qty: fields.stockQty,
        unitCost: unitCostForStock(fields.hargaBeli, fields.konversiFactor, Boolean(refs.satuanKecilId)),
        userId: ctx.userId,
        warehouseId: refs.warehouseId,
        materialKode: kode,
      });
    } catch (stockError) {
      await ctx.db.from("raw_materials").delete().eq("id", created.id);
      return tally.skip(row.rowNumber, errorMessage(stockError, "Failed to create opening stock"));
    }
  }
  tally.imported += 1;
}

export async function importRawMaterials(
  db: DbClient,
  rows: ImportRow[],
  scope: { userId: string; companyId: string | null; branchId: string | null }
) {
  const ctx: Context = {
    db,
    ...scope,
    unitCache: new Map(),
    warehouseCache: new Map(),
    categoryCache: new Map(),
  };
  const tally = new ImportTally();

  for (const row of rows) {
    const fields = readRawMaterialRow(row.data);
    const missing = missingRawMaterialFields(fields);
    if (missing.length > 0) {
      tally.skip(row.rowNumber, `Required fields missing: ${missing.join(", ")}`);
      continue;
    }

    const kategori = await resolveCategoryCode(fields.kategori, ctx);
    if (!kategori) {
      tally.skip(
        row.rowNumber,
        `Category "${fields.kategori}" not found. Seed categories first or use a valid code.`
      );
      continue;
    }

    const kode = row.data.kode?.trim() || (await generateKode(ctx));
    const existingQuery = db.from("raw_materials").select("id").eq("kode", kode).is("deleted_at", null);
    const { data: existing } = await exactScope(existingQuery, ctx.companyId, ctx.branchId).maybeSingle();

    if (existing) await updateExisting(row, existing.id, kode, kategori, fields, ctx, tally);
    else await insertNew(row, kode, kategori, fields, ctx, tally);
  }

  return tally.summary();
}
