/**
 * Parser workbook "SIW - Menu Matrix*.xlsx".
 *
 * Workbook punya 4 bentuk sheet:
 *   1. "Market List"      — tabel datar bahan baku + WIP (header di baris ke-2).
 *   2. "WIP FOOD" / "WIP Beverage" — blok berulang: judul WIP, header, komponen, footer "Element Cost".
 *   3. Sheet stall (sisanya) — blok berulang: nama menu, header "Element", elemen, footer biaya.
 *   4. "Summary Menu"     — daftar menu + COGS/harga jual, dikelompokkan baris section per stall.
 *
 * Semua kolom diresolusi lewat nama header (bukan posisi) supaya tahan pergeseran kolom.
 */

import XLSX from "xlsx";

export const SHEET_MARKET_LIST = "Market List";
export const SHEET_SUMMARY = "Summary Menu";
export const WIP_SHEETS = ["WIP FOOD", "WIP Beverage"];

/** Kategori Market List yang menandai item WIP (bukan bahan beli). */
const WIP_CATEGORIES = new Set(["st koh wip", "st foh wip"]);

/** Label baris footer pada blok menu di sheet stall. */
const MENU_FOOTER_LABELS = new Map([
  ["boxes, packaging, etc.", "packaging"],
  ["direct cost", "directCost"],
  ["indirect cost", "indirectCost"],
  ["cost of goods sold (cogs)", "cogs"],
  ["margin", "margin"],
  ["div cogs", "divCogs"],
  ["selling price", "sellingPrice"],
]);

/** Label baris footer pada blok WIP. */
const WIP_FOOTER_LABELS = new Set(["element cost"]);

export function normText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function normKey(value) {
  return normText(value).toLowerCase();
}

/** Angka Excel bisa datang sebagai string formula-result; kembalikan null bila bukan angka. */
export function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function sheetRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });
}

function isBlankRow(row) {
  if (!row) return true;
  return row.every((cell) => cell === null || cell === undefined || normText(cell) === "");
}

/** Peta header→index dari sebuah baris, dinormalisasi lowercase. */
function headerMap(row) {
  const map = new Map();
  (row || []).forEach((cell, idx) => {
    const key = normKey(cell);
    if (key && !map.has(key)) map.set(key, idx);
  });
  return map;
}

function pick(map, ...aliases) {
  for (const alias of aliases) {
    const idx = map.get(normKey(alias));
    if (idx !== undefined) return idx;
  }
  return -1;
}

// ---------------------------------------------------------------- Market List

export function parseMarketList(workbook) {
  const sheetName = workbook.SheetNames.find((n) => normKey(n) === normKey(SHEET_MARKET_LIST));
  if (!sheetName) throw new Error(`Sheet "${SHEET_MARKET_LIST}" tidak ditemukan.`);

  const rows = sheetRows(workbook, sheetName);
  const headerIdx = rows.findIndex((row) => headerMap(row).has("ingredients"));
  if (headerIdx < 0) throw new Error(`Header "Ingredients" tidak ditemukan di sheet "${sheetName}".`);

  const h = headerMap(rows[headerIdx]);
  const col = {
    category: pick(h, "Category"),
    name: pick(h, "Ingredients", "Ingredient", "Bahan"),
    uom: pick(h, "UOM"),
    weight: pick(h, "Weight (gr/ea/ml)", "Weight"),
    unitCost: pick(h, "Unit Cost"),
    unitPrice: pick(h, "Unit Price / Unit", "Unit Price/Unit"),
    vendor: pick(h, "Vendor"),
    purchaseUnit: pick(h, "Purchase Unit"),
    purchaseUom: pick(h, "Purchase UOM"),
    note: pick(h, "Note"),
  };
  if (col.name < 0) throw new Error(`Kolom "Ingredients" tidak ditemukan di sheet "${sheetName}".`);

  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const name = normText(row[col.name]);
    if (!name) continue;
    const category = normText(row[col.category]);
    items.push({
      sheet: sheetName,
      excelRow: i + 1,
      category,
      name,
      uom: normText(row[col.uom]),
      weight: toNum(row[col.weight]),
      unitCost: toNum(row[col.unitCost]),
      unitPrice: toNum(row[col.unitPrice]),
      vendor: normText(row[col.vendor]),
      purchaseUnit: toNum(row[col.purchaseUnit]),
      purchaseUom: normText(row[col.purchaseUom]),
      note: normText(row[col.note]),
      isWip: WIP_CATEGORIES.has(normKey(category)) || /\bwip\b/i.test(name),
    });
  }
  return items;
}

// ------------------------------------------------------------------ WIP sheets

/**
 * Blok WIP: baris judul `[nama, unit cost, "Portion", batch qty, batch UOM]`,
 * lalu header `Ingredients | Use | UOM | Unit Price / Unit | Price | Major Step`,
 * lalu komponen, ditutup baris `Element Cost`.
 */
export function parseWipSheet(workbook, sheetName) {
  const rows = sheetRows(workbook, sheetName);
  const blocks = [];

  for (let i = 0; i < rows.length - 1; i += 1) {
    const titleRow = rows[i] || [];
    const nextRow = rows[i + 1] || [];
    if (!headerMap(nextRow).has("ingredients")) continue;

    const name = normText(titleRow[0]);
    if (!name) continue;

    const h = headerMap(nextRow);
    const col = {
      name: pick(h, "Ingredients", "Ingredient"),
      use: pick(h, "Use"),
      uom: pick(h, "UOM"),
      unitPrice: pick(h, "Unit Price / Unit", "Unit Price/Unit"),
      price: pick(h, "Price"),
      step: pick(h, "Major Step"),
    };
    if (col.price < 0 && col.unitPrice >= 0) col.price = col.unitPrice + 1;

    const components = [];
    let elementCost = null;
    let j = i + 2;
    for (; j < rows.length; j += 1) {
      const row = rows[j] || [];
      const label = normText(row[col.name]);
      // Blok menyisakan slot kosong di tengah sebelum footer — dilewati, bukan
      // dijadikan penanda akhir blok.
      if (!label) continue;
      if (WIP_FOOTER_LABELS.has(normKey(label))) {
        elementCost = toNum(row[col.price]);
        j += 1;
        break;
      }
      if (headerMap(row).has("ingredients")) break;
      // Baris judul WIP berikutnya: baris sesudahnya adalah header "Ingredients".
      if (headerMap(rows[j + 1] || []).has("ingredients")) break;
      components.push({
        excelRow: j + 1,
        name: label,
        use: toNum(row[col.use]),
        uom: normText(row[col.uom]),
        unitPrice: toNum(row[col.unitPrice]),
        price: toNum(row[col.price]),
        step: normText(row[col.step]),
      });
    }

    blocks.push({
      sheet: sheetName,
      excelRow: i + 1,
      name,
      unitCost: toNum(titleRow[1]),
      yieldLabel: normText(titleRow[2]),
      batchQty: toNum(titleRow[3]),
      batchUom: normText(titleRow[4]),
      elementCost,
      components,
    });
    i = j - 1;
  }
  return blocks;
}

// ---------------------------------------------------------------- Stall sheets

/**
 * Blok menu: baris nama menu, lalu header `Element | UOM | ... | Portion Used | Value /pcs`,
 * lalu baris elemen, ditutup baris footer biaya (Direct Cost … Selling Price).
 */
export function parseStallSheet(workbook, sheetName) {
  const rows = sheetRows(workbook, sheetName);
  const menus = [];

  for (let i = 0; i < rows.length - 1; i += 1) {
    const titleRow = rows[i] || [];
    const nextRow = rows[i + 1] || [];
    if (!headerMap(nextRow).has("element")) continue;

    const name = normText(titleRow[0]);
    if (!name) continue;

    const h = headerMap(nextRow);
    const col = {
      name: pick(h, "Element"),
      uom: pick(h, "UOM"),
      elementCost: pick(h, "Element Cost/(g)", "Element Cost"),
      portionUsed: pick(h, "Portion Used"),
      value: pick(h, "Value /pcs", "Value/pcs"),
      step: pick(h, "Major Step"),
      units: pick(h, "Units"),
    };
    // Beberapa blok punya sel header "Value /pcs" yang terisi angka, bukan teks
    // (mis. 7 menu di sheet Sushi). Kolomnya tetap ada, posisinya persis setelah
    // "Portion Used" — jatuh balik ke situ daripada melewatkan seluruh biaya blok.
    if (col.value < 0 && col.portionUsed >= 0) col.value = col.portionUsed + 1;

    const elements = [];
    const footer = {};
    let j = i + 2;
    for (; j < rows.length; j += 1) {
      const row = rows[j] || [];
      const label = normText(row[col.name]);
      if (!label) {
        if (isBlankRow(row)) continue; // baris kosong di tengah blok (template menyisakan slot)
        continue;
      }
      const footerKey = MENU_FOOTER_LABELS.get(normKey(label));
      if (footerKey) {
        footer[footerKey] = toNum(row[col.value]);
        if (footerKey === "sellingPrice") { j += 1; break; }
        continue;
      }
      if (headerMap(row).has("element")) break;
      // Baris nama menu berikutnya: kolom selain nama kosong DAN baris sesudahnya header.
      const looksLikeNextTitle =
        headerMap(rows[j + 1] || []).has("element") &&
        row.slice(1).every((cell) => cell === null || normText(cell) === "");
      if (looksLikeNextTitle) break;

      elements.push({
        excelRow: j + 1,
        name: label,
        uom: normText(row[col.uom]),
        elementCost: toNum(row[col.elementCost]),
        portionUsed: toNum(row[col.portionUsed]),
        value: toNum(row[col.value]),
        step: normText(row[col.step]),
        units: normText(row[col.units]),
      });
    }

    menus.push({ sheet: sheetName, excelRow: i + 1, name, elements, ...footer });
    i = j - 1;
  }
  return menus;
}

// --------------------------------------------------------------- Summary Menu

export function parseSummary(workbook) {
  const sheetName = workbook.SheetNames.find((n) => normKey(n) === normKey(SHEET_SUMMARY));
  if (!sheetName) return [];

  const rows = sheetRows(workbook, sheetName);
  const headerIdx = rows.findIndex((row) => headerMap(row).has("menu"));
  if (headerIdx < 0) return [];

  const h = headerMap(rows[headerIdx]);
  const col = {
    name: pick(h, "Menu"),
    cogs: pick(h, "COGS"),
    price: pick(h, "Selling Price"),
    foodCost: pick(h, "Food Cost %"),
    status: pick(h, "Status"),
    desc: pick(h, "Description"),
  };

  const out = [];
  let currentStall = "";
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const name = normText(row[col.name]);
    if (!name) continue;
    const status = normText(row[col.status]);
    const price = toNum(row[col.price]);
    const cogs = toNum(row[col.cogs]);
    // Baris non-menu selalu tanpa Status. Dua bentuknya:
    //   - section stall  → punya COGS rata-rata stall  → jadi grouping menu di bawahnya
    //   - baris agregat  → COGS kosong (Food Cost, Average Transaction, dst) → dilewati
    if (!status) {
      if (cogs !== null) currentStall = name;
      continue;
    }
    if (normKey(name) === "avg product cost") continue;
    out.push({
      sheet: sheetName,
      excelRow: i + 1,
      stall: currentStall,
      name,
      cogs,
      sellingPrice: price,
      foodCostPct: toNum(row[col.foodCost]),
      status,
      description: normText(row[col.desc]),
    });
  }
  return out;
}

// ------------------------------------------------------------------- Aggregate

export function parseMenuMatrix(xlsxPath) {
  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const known = new Set(
    [SHEET_SUMMARY, SHEET_MARKET_LIST, ...WIP_SHEETS].map((n) => normKey(n))
  );
  const stallSheets = workbook.SheetNames.filter((n) => !known.has(normKey(n)));
  const wipSheets = workbook.SheetNames.filter((n) => WIP_SHEETS.some((w) => normKey(w) === normKey(n)));

  const wipBlocks = wipSheets.flatMap((n) => parseWipSheet(workbook, n));
  const menus = stallSheets.flatMap((n) => parseStallSheet(workbook, n));

  return {
    file: xlsxPath,
    sheetNames: workbook.SheetNames,
    stallSheets,
    wipSheets,
    marketList: parseMarketList(workbook),
    wipBlocks,
    menus,
    summary: parseSummary(workbook),
  };
}
