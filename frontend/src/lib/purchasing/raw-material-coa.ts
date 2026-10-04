/**
 * Mapping kategori bahan baku → default Chart of Accounts (SULU).
 * Sumber kategori Market List / Inv. Storage di docs/data/SULU - COA .xlsx
 * dan sheet Market List Menu Matrix.
 *
 * Opsi A: kategori mengisi default `coa_asset` (akun inventori).
 * `coa_production` boleh diisi default COGS food bila relevan; R&D manual.
 */

export type RawMaterialCoaDefaults = {
  /** Kode akun inventori / expense (Aset) */
  coa_asset: string | null;
  /** Kode akun pemakaian produksi (COGS / expense) */
  coa_production: string | null;
  /** Label akun aset untuk hint UI */
  coa_asset_label: string | null;
  coa_production_label: string | null;
};

/** Kode akun inventori storage (level 4, postable). */
export const COA_INV = {
  DRY_GOODS: "1301001",
  DAIRY_EGGS: "1301002",
  SAUCE_SYRUP: "1301003",
  FROZEN: "1301004",
  RTD: "1301005",
  KOH_WIP: "1301006",
  FOH_WIP: "1301007",
  OTHER: "1301008",
} as const;

export const COA_COGS = {
  FOOD_RAW: "5101001",
  FOOD_SPOIL: "5101002",
  FRUIT_VEG: "5101003",
  BEV_RAW: "5201001",
} as const;

export const COA_EXPENSE = {
  PRODUCTION_SUPPLIES: "6201001",
  CHEMICAL: "6201002",
  PRODUCTION_FUEL: "6201005",
} as const;

const ASSET_LABELS: Record<string, string> = {
  [COA_INV.DRY_GOODS]: "Inv - ST Dry Goods",
  [COA_INV.DAIRY_EGGS]: "Inv - ST Dairy & Eggs",
  [COA_INV.SAUCE_SYRUP]: "Inv - ST Sauce, Syrup & Condiment",
  [COA_INV.FROZEN]: "Inv - ST Frozen Ingredients",
  [COA_INV.RTD]: "Inv - ST RTD",
  [COA_INV.KOH_WIP]: "Inv - ST KOH WIP",
  [COA_INV.FOH_WIP]: "Inv - ST FOH WIP",
  [COA_INV.OTHER]: "Inv - ST Other",
  [COA_EXPENSE.PRODUCTION_SUPPLIES]: "Production Supplies",
  [COA_EXPENSE.PRODUCTION_FUEL]: "Production Fuel",
};

const PRODUCTION_LABELS: Record<string, string> = {
  [COA_COGS.FOOD_RAW]: "Cost of Food Raw Material",
  [COA_COGS.FRUIT_VEG]: "Cost Of Fruit and Vegetable",
  [COA_COGS.BEV_RAW]: "Cost of Bev Raw Material",
  [COA_EXPENSE.PRODUCTION_SUPPLIES]: "Production Supplies",
  [COA_EXPENSE.PRODUCTION_FUEL]: "Production Fuel",
};

/** Market List Category (exact / normalized) → akun inventori */
const MARKET_CATEGORY_ASSET: Record<string, string> = {
  "st dry goods": COA_INV.DRY_GOODS,
  "st dairy & eggs": COA_INV.DAIRY_EGGS,
  "st dairy and eggs": COA_INV.DAIRY_EGGS,
  "st sauce, syrup & condiment": COA_INV.SAUCE_SYRUP,
  "st sauce syrup & condiment": COA_INV.SAUCE_SYRUP,
  "st frozen ingredients": COA_INV.FROZEN,
  "st rtd": COA_INV.RTD,
  "st koh wip": COA_INV.KOH_WIP,
  "st foh wip": COA_INV.FOH_WIP,
  "st other": COA_INV.OTHER,
  "st protein": COA_INV.OTHER,
  "fruit & vegetable": COA_INV.OTHER,
  "fruit and vegetable": COA_INV.OTHER,
  "fruit and vegetables": COA_INV.OTHER,
  "production supplies": COA_EXPENSE.PRODUCTION_SUPPLIES,
  "production fuel": COA_EXPENSE.PRODUCTION_FUEL,
};

/** Kode master item.raw_material_categories → akun inventori */
const SYSTEM_CATEGORY_ASSET: Record<string, string> = {
  KERING: COA_INV.DRY_GOODS,
  BUMBU: COA_INV.DRY_GOODS,
  BAKERY: COA_INV.DRY_GOODS,
  OIL: COA_INV.DRY_GOODS,
  DAIRY: COA_INV.DAIRY_EGGS,
  SAUS: COA_INV.SAUCE_SYRUP,
  MINUMAN: COA_INV.SAUCE_SYRUP,
  BEKU: COA_INV.FROZEN,
  DAGING: COA_INV.OTHER,
  SEAFOOD: COA_INV.OTHER,
  PROTEIN: COA_INV.OTHER,
  SAYUR: COA_INV.OTHER,
  LAIN: COA_INV.OTHER,
  NONPANG: COA_EXPENSE.PRODUCTION_SUPPLIES,
  KEMASAN: COA_EXPENSE.PRODUCTION_SUPPLIES,
  BAKAR: COA_EXPENSE.PRODUCTION_FUEL,
};

const SYSTEM_CATEGORY_PRODUCTION: Record<string, string> = {
  KERING: COA_COGS.FOOD_RAW,
  BUMBU: COA_COGS.FOOD_RAW,
  BAKERY: COA_COGS.FOOD_RAW,
  OIL: COA_COGS.FOOD_RAW,
  DAIRY: COA_COGS.FOOD_RAW,
  SAUS: COA_COGS.FOOD_RAW,
  BEKU: COA_COGS.FOOD_RAW,
  DAGING: COA_COGS.FOOD_RAW,
  SEAFOOD: COA_COGS.FOOD_RAW,
  PROTEIN: COA_COGS.FOOD_RAW,
  SAYUR: COA_COGS.FRUIT_VEG,
  MINUMAN: COA_COGS.BEV_RAW,
  LAIN: COA_COGS.FOOD_RAW,
  NONPANG: COA_EXPENSE.PRODUCTION_SUPPLIES,
  KEMASAN: COA_EXPENSE.PRODUCTION_SUPPLIES,
  BAKAR: COA_EXPENSE.PRODUCTION_FUEL,
};

function normalizeKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveDefaultCoaForCategory(
  kategori: string | null | undefined
): RawMaterialCoaDefaults {
  const raw = String(kategori || "").trim();
  const upper = raw.toUpperCase();
  const key = normalizeKey(raw);

  let asset =
    SYSTEM_CATEGORY_ASSET[upper] ||
    MARKET_CATEGORY_ASSET[key] ||
    null;

  // Prefix WIP → KOH WIP inventory
  if (!asset && (upper.includes("WIP") || key.includes("wip"))) {
    asset = COA_INV.KOH_WIP;
  }

  let production =
    SYSTEM_CATEGORY_PRODUCTION[upper] ||
    (asset === COA_INV.OTHER && key.includes("fruit")
      ? COA_COGS.FRUIT_VEG
      : asset && asset.startsWith("13")
        ? COA_COGS.FOOD_RAW
        : asset && asset.startsWith("62")
          ? asset
          : null);

  if (key.includes("fruit") && !SYSTEM_CATEGORY_PRODUCTION[upper]) {
    production = COA_COGS.FRUIT_VEG;
  }

  if (asset === COA_INV.KOH_WIP || asset === COA_INV.FOH_WIP) {
    production = COA_COGS.FOOD_RAW;
  }
  if (asset === COA_INV.RTD) {
    production = COA_COGS.BEV_RAW;
  }

  return {
    coa_asset: asset,
    coa_production: production,
    coa_asset_label: asset ? ASSET_LABELS[asset] ?? null : null,
    coa_production_label: production
      ? PRODUCTION_LABELS[production] ?? null
      : null,
  };
}

/** Legacy enum PRODUCTION | RND | ASSET dari tiga kode akun. */
export function deriveLegacyCoaEnum(input: {
  coa_production?: string | null;
  coa_rnd?: string | null;
  coa_asset?: string | null;
}): "PRODUCTION" | "RND" | "ASSET" | null {
  if (input.coa_production) return "PRODUCTION";
  if (input.coa_rnd) return "RND";
  if (input.coa_asset) return "ASSET";
  return null;
}
