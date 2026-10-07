/**
 * Shared COA mapping for seeders (mirrors src/lib/purchasing/raw-material-coa.ts).
 * Market List Category / system kategori → chart of accounts codes.
 */

const COA_INV = {
  DRY_GOODS: "1301001",
  DAIRY_EGGS: "1301002",
  SAUCE_SYRUP: "1301003",
  FROZEN: "1301004",
  RTD: "1301005",
  KOH_WIP: "1301006",
  FOH_WIP: "1301007",
  OTHER: "1301008",
};

const COA_COGS = {
  FOOD_RAW: "5101001",
  FRUIT_VEG: "5101003",
  BEV_RAW: "5201001",
};

const COA_EXPENSE = {
  PRODUCTION_SUPPLIES: "6201001",
  PRODUCTION_FUEL: "6201005",
};

const MARKET_CATEGORY_ASSET = {
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

/** Market List Category → kode master item.raw_material_categories */
const MARKET_TO_SYSTEM_KATEGORI = {
  "st dry goods": "KERING",
  "st dairy & eggs": "DAIRY",
  "st dairy and eggs": "DAIRY",
  "st sauce, syrup & condiment": "SAUS",
  "st sauce syrup & condiment": "SAUS",
  "st frozen ingredients": "BEKU",
  "st rtd": "MINUMAN",
  "st koh wip": "LAIN",
  "st foh wip": "LAIN",
  "st other": "LAIN",
  "st protein": "DAGING",
  "fruit & vegetable": "SAYUR",
  "fruit and vegetable": "SAYUR",
  "fruit and vegetables": "SAYUR",
  "production supplies": "NONPANG",
  "production fuel": "BAKAR",
};

const SYSTEM_CATEGORY_ASSET = {
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

const SYSTEM_CATEGORY_PRODUCTION = {
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

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveDefaultCoaForCategory(kategori) {
  const raw = String(kategori || "").trim();
  const upper = raw.toUpperCase();
  const key = normalizeKey(raw);

  let asset = SYSTEM_CATEGORY_ASSET[upper] || MARKET_CATEGORY_ASSET[key] || null;
  if (!asset && (upper.includes("WIP") || key.includes("wip"))) {
    asset = COA_INV.KOH_WIP;
  }

  let production =
    SYSTEM_CATEGORY_PRODUCTION[upper] ||
    (asset === COA_INV.OTHER && key.includes("fruit")
      ? COA_COGS.FRUIT_VEG
      : asset && String(asset).startsWith("13")
        ? COA_COGS.FOOD_RAW
        : asset && String(asset).startsWith("62")
          ? asset
          : null);

  if (key.includes("fruit") && !SYSTEM_CATEGORY_PRODUCTION[upper]) {
    production = COA_COGS.FRUIT_VEG;
  }

  // KOH/FOH WIP production still COGS food
  if (asset === COA_INV.KOH_WIP || asset === COA_INV.FOH_WIP) {
    production = COA_COGS.FOOD_RAW;
  }
  if (asset === COA_INV.RTD) {
    production = COA_COGS.BEV_RAW;
  }

  return { coa_asset: asset, coa_production: production };
}

function deriveLegacyCoaEnum({ coa_production, coa_rnd, coa_asset }) {
  if (coa_production) return "PRODUCTION";
  if (coa_rnd) return "RND";
  if (coa_asset) return "ASSET";
  return null;
}

function systemKategoriFromMarketCategory(marketCategory) {
  const key = normalizeKey(marketCategory);
  return MARKET_TO_SYSTEM_KATEGORI[key] || null;
}

module.exports = {
  COA_INV,
  COA_COGS,
  COA_EXPENSE,
  normalizeKey,
  normalizeName,
  resolveDefaultCoaForCategory,
  deriveLegacyCoaEnum,
  systemKategoriFromMarketCategory,
};
