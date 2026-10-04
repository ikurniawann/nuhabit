/**
 * Mesin diff Menu Matrix ↔ database.
 *
 * Semua temuan memakai satu bentuk baris supaya bisa ditulis ke CSV seragam:
 *   { severity, dimension, entity, key, field, excelValue, dbValue, delta, nearMatch, note }
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeName } = require("../../../database/seeders/lib/raw-material-coa-map.js");

export const SEVERITY = {
  MISSING_IN_DB: "MISSING_IN_DB",
  EXTRA_IN_DB: "EXTRA_IN_DB",
  VALUE_MISMATCH: "VALUE_MISMATCH",
  RENAME_CANDIDATE: "RENAME_CANDIDATE",
  DATA_QUALITY: "DATA_QUALITY",
};

export const TOL = { money: 0.01, qty: 0.0001, ratio: 0.0001 };

/** UOM di workbook → kode item.units. `null` = tidak bisa dipetakan (dilaporkan terpisah). */
const UNIT_MAP = new Map(
  Object.entries({
    gr: "GR", gram: "GR", g: "GR",
    ml: "ML",
    l: "L", liter: "L", litre: "L",
    kg: "KG",
    butir: "BUTIR",
    pcs: "PCS", pc: "PCS", piece: "PCS",
    sheets: "LBR", sheet: "LBR", lembar: "LBR", lbr: "LBR",
    pack: "PACK",
    bottle: "BTL", botol: "BTL",
    galon: "GAL", gal: "GAL", gallon: "GAL",
    can: "CAN", kaleng: "CAN",
    jar: "JAR",
    iket: "IKAT", ikat: "IKAT",
    box: "BOX", tray: "TRAY", roll: "ROLL", slice: "SLICE", cup: "CUP",
    porsi: "PORSI", portion: "PORSI",
    wip: "PORSI",
  })
);

export function mapUnit(uom) {
  const key = String(uom || "").trim().toLowerCase();
  if (!key) return null;
  return UNIT_MAP.get(key) || null;
}

export function nkey(value) {
  return normalizeName(value);
}

// ------------------------------------------------------------- fuzzy matching

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const x = nkey(a);
  const y = nkey(b);
  if (!x || !y) return 0;
  const max = Math.max(x.length, y.length);
  return max === 0 ? 1 : 1 - levenshtein(x, y) / max;
}

/** Kandidat rename terbaik dari `pool` untuk `name`, minimal `threshold` kemiripan. */
export function bestNearMatch(name, pool, threshold = 0.82) {
  let best = null;
  let bestScore = 0;
  for (const candidate of pool) {
    const score = similarity(name, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= threshold ? { name: best, score: bestScore } : null;
}

// ----------------------------------------------------------------- comparison

export function numMismatch(excel, db, tol) {
  if (excel === null || excel === undefined) return null;
  if (db === null || db === undefined) return { delta: null };
  const diff = Number(excel) - Number(db);
  return Math.abs(diff) > tol ? { delta: diff } : null;
}

function finding(row) {
  return {
    severity: row.severity,
    dimension: row.dimension,
    entity: row.entity || "",
    key: row.key || "",
    field: row.field || "",
    excelValue: row.excelValue ?? "",
    dbValue: row.dbValue ?? "",
    delta: row.delta ?? "",
    nearMatch: row.nearMatch ?? "",
    note: row.note || "",
  };
}

/**
 * Index nama → record. Nama dengan garis miring ("Kyuri/Japanese Cucumber")
 * juga diindeks per-bagian, mengikuti perilaku seeder COA.
 */
export function indexByName(records, nameOf) {
  const index = new Map();
  for (const record of records) {
    const raw = nameOf(record);
    const keys = new Set([nkey(raw)]);
    if (String(raw).includes("/")) {
      for (const part of String(raw).split("/")) {
        const k = nkey(part);
        if (k) keys.add(k);
      }
    }
    for (const key of keys) if (key && !index.has(key)) index.set(key, record);
  }
  return index;
}

/** Biaya per satuan kecil di DB (harga_beli selalu per satuan besar). */
export function dbUnitCost(rm) {
  const harga = Number(rm.harga_beli);
  const konv = Number(rm.konversi_factor);
  if (!Number.isFinite(harga)) return null;
  if (!Number.isFinite(konv) || konv === 0) return harga;
  return harga / konv;
}


/** Baris resep yang menyebut bahan sama lebih dari sekali digabung qty-nya. */
function mergeByName(rows, nameOf, qtyOf, setQty) {
  const out = [];
  const seen = new Map();
  for (const row of rows) {
    const key = nkey(nameOf(row));
    const hit = seen.get(key);
    if (!hit) {
      const copy = { ...row };
      seen.set(key, copy);
      out.push(copy);
      continue;
    }
    setQty(hit, Number(qtyOf(hit) || 0) + Number(qtyOf(row) || 0));
  }
  return out;
}

// ------------------------------------------- A. bahan baku beli (Market List)

export function compareRawMaterials({ marketList, dbRawMaterials, systemKategoriFromMarketCategory }) {
  const dimension = "A. Bahan Baku (Market List)";
  const findings = [];

  const excelItems = marketList.filter((item) => !item.isWip);
  const dbItems = dbRawMaterials.filter((rm) => rm.material_type === "PURCHASED");
  const dbIndex = indexByName(dbItems, (rm) => rm.nama);
  const dbAllIndex = indexByName(dbRawMaterials, (rm) => rm.nama);
  const excelIndex = indexByName(excelItems, (item) => item.name);
  const excelAllIndex = indexByName(marketList, (item) => item.name);

  const matchedDb = new Set();

  for (const item of excelItems) {
    let rm = dbIndex.get(nkey(item.name));
    if (!rm) {
      // Bisa jadi item-nya ada, tapi tercatat sebagai WIP di database.
      const other = dbAllIndex.get(nkey(item.name));
      if (other) {
        matchedDb.add(other.id);
        findings.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension,
            entity: "raw_material",
            key: item.name,
            field: "material_type",
            excelValue: `PURCHASED (kategori "${item.category}")`,
            dbValue: other.material_type,
            note: `kode ${other.kode} — klasifikasi beli/WIP berbeda`,
          })
        );
        rm = other;
      } else {
        findings.push(
          finding({
            severity: SEVERITY.MISSING_IN_DB,
            dimension,
            entity: "raw_material",
            key: item.name,
            field: "existence",
            excelValue: `${item.category} | ${item.uom} | ${item.unitCost}`,
            note: `Market List baris ${item.excelRow}`,
          })
        );
        continue;
      }
    }
    matchedDb.add(rm.id);

    const expectedKategori = systemKategoriFromMarketCategory(item.category);
    if (expectedKategori && expectedKategori !== rm.kategori) {
      findings.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "kategori",
          excelValue: `${item.category} → ${expectedKategori}`,
          dbValue: rm.kategori,
          note: `kode ${rm.kode}`,
        })
      );
    }

    const smallUnit = mapUnit(item.uom);
    if (!smallUnit && item.uom) {
      findings.push(
        finding({
          severity: SEVERITY.DATA_QUALITY,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "UOM",
          excelValue: item.uom,
          dbValue: rm.satuan_kecil,
          note: "UOM workbook tidak dikenali pemetaan satuan",
        })
      );
    } else if (smallUnit && rm.satuan_kecil && smallUnit !== rm.satuan_kecil) {
      findings.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "satuan_kecil",
          excelValue: `${item.uom} → ${smallUnit}`,
          dbValue: rm.satuan_kecil,
          note: `kode ${rm.kode}`,
        })
      );
    }

    const bigUnit = mapUnit(item.purchaseUom);
    if (!bigUnit && item.purchaseUom) {
      findings.push(
        finding({
          severity: SEVERITY.DATA_QUALITY,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "Purchase UOM",
          excelValue: item.purchaseUom,
          dbValue: rm.satuan_besar,
          note: "Purchase UOM workbook tidak dikenali pemetaan satuan",
        })
      );
    } else if (bigUnit && rm.satuan_besar && bigUnit !== rm.satuan_besar) {
      findings.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "satuan_besar",
          excelValue: `${item.purchaseUom} → ${bigUnit}`,
          dbValue: rm.satuan_besar,
          note: `kode ${rm.kode}`,
        })
      );
    }

    const konv = numMismatch(item.weight, Number(rm.konversi_factor), TOL.qty);
    if (konv) {
      findings.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "konversi_factor",
          excelValue: item.weight,
          dbValue: Number(rm.konversi_factor),
          delta: konv.delta,
          note: `Weight (gr/ea/ml) vs konversi_factor — kode ${rm.kode}`,
        })
      );
    }

    const harga = numMismatch(item.unitCost, Number(rm.harga_beli), TOL.money);
    if (harga) {
      findings.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "harga_beli",
          excelValue: item.unitCost,
          dbValue: Number(rm.harga_beli),
          delta: harga.delta,
          note: `Unit Cost vs harga_beli — kode ${rm.kode}`,
        })
      );
    }

    const perUnit = numMismatch(item.unitPrice, dbUnitCost(rm), TOL.money);
    if (perUnit) {
      findings.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension,
          entity: "raw_material",
          key: item.name,
          field: "biaya per satuan kecil",
          excelValue: item.unitPrice,
          dbValue: dbUnitCost(rm),
          delta: perUnit.delta,
          note: `Unit Price/Unit vs harga_beli/konversi_factor — kode ${rm.kode}`,
        })
      );
    }
  }

  for (const rm of dbItems) {
    if (matchedDb.has(rm.id)) continue;
    if (excelIndex.has(nkey(rm.nama))) continue;
    const asWip = excelAllIndex.get(nkey(rm.nama));
    if (asWip) {
      // Di workbook item ini WIP, di DB tercatat PURCHASED — dilaporkan di dimensi B.
      continue;
    }
    findings.push(
      finding({
        severity: SEVERITY.EXTRA_IN_DB,
        dimension,
        entity: "raw_material",
        key: rm.nama,
        field: "existence",
        dbValue: `${rm.kode} | ${rm.kategori} | ${rm.harga_beli}`,
        note: "Ada di DB tapi tidak ada di Market List",
      })
    );
  }

  return annotateRenames(findings);
}

// -------------------------------------------------- B. master WIP + C. resep WIP

export function compareWip({ marketList, wipBlocks, dbRawMaterials, dbRawMaterialBom }) {
  const dimMaster = "B. Master WIP";
  const dimBom = "C. Resep WIP";
  const master = [];
  const bom = [];

  const excelWipMarket = marketList.filter((item) => item.isWip);
  const marketIndex = indexByName(excelWipMarket, (item) => item.name);
  const blockIndex = indexByName(wipBlocks, (block) => block.name);
  const dbWip = dbRawMaterials.filter((rm) => rm.material_type === "WIP");
  const dbIndex = indexByName(dbWip, (rm) => rm.nama);
  const allDbIndex = indexByName(dbRawMaterials, (rm) => rm.nama);
  const matchedDb = new Set();

  // Integritas workbook: judul blok WIP harus muncul di Market List dan sebaliknya.
  for (const block of wipBlocks) {
    if (!marketIndex.has(nkey(block.name))) {
      master.push(
        finding({
          severity: SEVERITY.DATA_QUALITY,
          dimension: dimMaster,
          entity: "wip",
          key: block.name,
          field: "Market List",
          excelValue: `${block.sheet} baris ${block.excelRow}`,
          note: "Blok WIP tidak terdaftar di sheet Market List",
        })
      );
    }
  }
  for (const item of excelWipMarket) {
    if (!blockIndex.has(nkey(item.name))) {
      master.push(
        finding({
          severity: SEVERITY.DATA_QUALITY,
          dimension: dimMaster,
          entity: "wip",
          key: item.name,
          field: "sheet WIP",
          excelValue: `Market List baris ${item.excelRow}`,
          note: "Terdaftar di Market List tapi tidak punya blok resep di sheet WIP",
        })
      );
    }
  }

  for (const block of wipBlocks) {
    let rm = dbIndex.get(nkey(block.name)) || null;
    if (!rm) {
      const other = allDbIndex.get(nkey(block.name));
      if (other) {
        rm = other;
        master.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension: dimMaster,
            entity: "wip",
            key: block.name,
            field: "material_type",
            excelValue: "WIP",
            dbValue: other.material_type,
            note: `kode ${other.kode} — punya blok resep di ${other.material_type === "PURCHASED" ? "workbook tapi di DB dicatat sebagai bahan beli" : "workbook"}`,
          })
        );
      }
    }

    // Konsistensi internal workbook: Element Cost / batch = unit cost.
    if (block.elementCost !== null && block.batchQty) {
      const derived = block.elementCost / block.batchQty;
      const bad = numMismatch(derived, block.unitCost, TOL.money);
      if (bad) {
        master.push(
          finding({
            severity: SEVERITY.DATA_QUALITY,
            dimension: dimMaster,
            entity: "wip",
            key: block.name,
            field: "unit cost workbook",
            excelValue: `${block.elementCost} / ${block.batchQty} = ${derived}`,
            dbValue: block.unitCost,
            delta: derived - block.unitCost,
            note: `${block.sheet}: Element Cost / batch tidak sama dengan unit cost di baris judul`,
          })
        );
      }
    }

    if (!rm) {
      master.push(
        finding({
          severity: SEVERITY.MISSING_IN_DB,
          dimension: dimMaster,
          entity: "wip",
          key: block.name,
          field: "existence",
          excelValue: `${block.sheet} baris ${block.excelRow} | batch ${block.batchQty} ${block.batchUom}`,
          note: "WIP belum ada di item.raw_materials (material_type=WIP)",
        })
      );
      continue;
    }
    matchedDb.add(rm.id);

    const cost = numMismatch(block.unitCost, dbUnitCost(rm), TOL.money);
    if (cost) {
      master.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension: dimMaster,
          entity: "wip",
          key: block.name,
          field: "biaya per satuan",
          excelValue: block.unitCost,
          dbValue: dbUnitCost(rm),
          delta: cost.delta,
          note: `kode ${rm.kode}`,
        })
      );
    }

    // ---- resep WIP
    const dbLines = dbRawMaterialBom.get(rm.id) || [];
    const dbLineIndex = indexByName(dbLines, (line) => line.component_nama);
    const seen = new Set();

    for (const comp of mergeByName(block.components, (c) => c.name, (c) => c.use, (c, v) => { c.use = v; })) {
      const line = dbLineIndex.get(nkey(comp.name));
      if (!line) {
        bom.push(
          finding({
            severity: SEVERITY.MISSING_IN_DB,
            dimension: dimBom,
            entity: "wip_bom",
            key: `${block.name} → ${comp.name}`,
            field: "component",
            excelValue: `${comp.use ?? ""} ${comp.uom}`,
            note: allDbIndex.has(nkey(comp.name))
              ? "Komponen ada di master tapi tidak terpasang di resep WIP"
              : "Komponen bahkan tidak ada di item.raw_materials",
          })
        );
        continue;
      }
      seen.add(line.id);

      const qty = numMismatch(comp.use, Number(line.qty_required), TOL.qty);
      if (qty) {
        bom.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension: dimBom,
            entity: "wip_bom",
            key: `${block.name} → ${comp.name}`,
            field: "qty_required",
            excelValue: comp.use,
            dbValue: Number(line.qty_required),
            delta: qty.delta,
          })
        );
      }

      const unit = mapUnit(comp.uom);
      if (unit && line.satuan && unit !== line.satuan) {
        bom.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension: dimBom,
            entity: "wip_bom",
            key: `${block.name} → ${comp.name}`,
            field: "satuan",
            excelValue: `${comp.uom} → ${unit}`,
            dbValue: line.satuan,
          })
        );
      }
    }

    for (const line of dbLines) {
      if (seen.has(line.id)) continue;
      bom.push(
        finding({
          severity: SEVERITY.EXTRA_IN_DB,
          dimension: dimBom,
          entity: "wip_bom",
          key: `${block.name} → ${line.component_nama}`,
          field: "component",
          dbValue: `${line.qty_required} ${line.satuan || ""}`,
          note: "Komponen ada di DB tapi tidak ada di blok WIP workbook",
        })
      );
    }
  }

  for (const rm of dbWip) {
    if (matchedDb.has(rm.id)) continue;
    if (blockIndex.has(nkey(rm.nama))) continue;
    master.push(
      finding({
        severity: SEVERITY.EXTRA_IN_DB,
        dimension: dimMaster,
        entity: "wip",
        key: rm.nama,
        field: "existence",
        dbValue: `${rm.kode} | ${rm.harga_beli}`,
        note: "WIP di DB tanpa blok resep di workbook",
      })
    );
  }

  return {
    master: annotateRenames(master),
    bom,
  };
}

// ------------------------------------------- D. produk + E. BOM produk

export function compareProducts({ menus, summary, dbProducts, dbBom, dbRawMaterials }) {
  const dimProduct = "D. Produk / Menu";
  const dimBom = "E. BOM Produk";
  const product = [];
  const bom = [];

  const summaryIndex = indexByName(summary, (row) => row.name);
  const menuIndex = indexByName(menus, (menu) => menu.name);
  const dbIndex = indexByName(dbProducts, (p) => p.nama);
  const rmIndex = indexByName(dbRawMaterials, (rm) => rm.nama);
  const matchedDb = new Set();

  for (const menu of menus) {
    const summaryRow = summaryIndex.get(nkey(menu.name)) || null;
    const p = dbIndex.get(nkey(menu.name));

    if (!p) {
      product.push(
        finding({
          severity: SEVERITY.MISSING_IN_DB,
          dimension: dimProduct,
          entity: "product",
          key: menu.name,
          field: "existence",
          excelValue: `${menu.sheet} baris ${menu.excelRow} | COGS ${menu.cogs ?? ""} | harga ${menu.sellingPrice ?? ""}`,
          note: summaryRow ? `status: ${summaryRow.status}` : "tidak ada di Summary Menu",
        })
      );
      continue;
    }
    matchedDb.add(p.id);

    const price = numMismatch(menu.sellingPrice, Number(p.harga_jual), TOL.money);
    if (price) {
      product.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension: dimProduct,
          entity: "product",
          key: menu.name,
          field: "harga_jual",
          excelValue: menu.sellingPrice,
          dbValue: Number(p.harga_jual),
          delta: price.delta,
          note: `kode ${p.kode}`,
        })
      );
    }

    // `harga_modal` di database menyimpan Direct Cost (Σ bahan), sesuai konvensi
    // yang sudah dipakai baris lama dan API /purchasing/cogs. COGS di workbook
    // sudah termasuk indirect cost 15% yang tidak dimodelkan di database.
    const target = menu.directCost ?? menu.cogs;
    const cogs = numMismatch(target, Number(p.harga_modal), TOL.money);
    if (cogs) {
      product.push(
        finding({
          severity: SEVERITY.VALUE_MISMATCH,
          dimension: dimProduct,
          entity: "product",
          key: menu.name,
          field: "harga_modal",
          excelValue: target,
          dbValue: Number(p.harga_modal),
          delta: cogs.delta,
          note: `Direct Cost workbook vs harga_modal — kode ${p.kode}`,
        })
      );
    }

    // ---- BOM produk
    const dbLines = dbBom.get(p.id) || [];
    const dbLineIndex = indexByName(dbLines, (line) => line.raw_material_nama);
    const seen = new Set();
    let dbCogs = 0;

    for (const line of dbLines) {
      const rm = rmIndex.get(nkey(line.raw_material_nama));
      const unitCost = rm ? dbUnitCost(rm) : null;
      if (unitCost !== null) dbCogs += Number(line.qty_required) * unitCost;
    }

    for (const element of mergeByName(menu.elements, (e) => e.name, (e) => e.portionUsed, (e, v) => { e.portionUsed = v; })) {
      const line = dbLineIndex.get(nkey(element.name));
      if (!line) {
        bom.push(
          finding({
            severity: SEVERITY.MISSING_IN_DB,
            dimension: dimBom,
            entity: "product_bom",
            key: `${menu.name} → ${element.name}`,
            field: "component",
            excelValue: `${element.portionUsed ?? ""} ${element.uom}`,
            note: rmIndex.has(nkey(element.name))
              ? "Bahan ada di master tapi tidak terpasang di BOM produk"
              : "Bahan tidak ada di item.raw_materials",
          })
        );
        continue;
      }
      seen.add(line.id);

      const qty = numMismatch(element.portionUsed, Number(line.qty_required), TOL.qty);
      if (qty) {
        bom.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension: dimBom,
            entity: "product_bom",
            key: `${menu.name} → ${element.name}`,
            field: "qty_required",
            excelValue: element.portionUsed,
            dbValue: Number(line.qty_required),
            delta: qty.delta,
          })
        );
      }

      const unit = mapUnit(element.uom);
      if (unit && line.satuan && unit !== line.satuan) {
        bom.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension: dimBom,
            entity: "product_bom",
            key: `${menu.name} → ${element.name}`,
            field: "satuan",
            excelValue: `${element.uom} → ${unit}`,
            dbValue: line.satuan,
          })
        );
      }
    }

    for (const line of dbLines) {
      if (seen.has(line.id)) continue;
      bom.push(
        finding({
          severity: SEVERITY.EXTRA_IN_DB,
          dimension: dimBom,
          entity: "product_bom",
          key: `${menu.name} → ${line.raw_material_nama}`,
          field: "component",
          dbValue: `${line.qty_required} ${line.satuan || ""}`,
          note: "Komponen ada di DB tapi tidak ada di sheet stall",
        })
      );
    }

    // Rekalkulasi COGS dari BOM DB vs Direct Cost workbook.
    if (dbLines.length && menu.directCost !== null && menu.directCost !== undefined) {
      const recalc = numMismatch(menu.directCost, dbCogs, TOL.money);
      if (recalc) {
        bom.push(
          finding({
            severity: SEVERITY.VALUE_MISMATCH,
            dimension: dimBom,
            entity: "product_bom",
            key: menu.name,
            field: "Direct Cost (rekalkulasi BOM)",
            excelValue: menu.directCost,
            dbValue: dbCogs,
            delta: menu.directCost - dbCogs,
            note: "Direct Cost workbook vs Σ(qty_required × biaya per satuan) dari BOM DB",
          })
        );
      }
    }
  }

  for (const p of dbProducts) {
    if (matchedDb.has(p.id)) continue;
    if (menuIndex.has(nkey(p.nama))) continue;
    product.push(
      finding({
        severity: SEVERITY.EXTRA_IN_DB,
        dimension: dimProduct,
        entity: "product",
        key: p.nama,
        field: "existence",
        dbValue: `${p.kode} | ${p.kategori} | ${p.harga_jual}`,
        note: "Produk di DB tanpa resep di workbook",
      })
    );
  }

  return {
    product: annotateRenames(product),
    bom,
  };
}

// -------------------------------------------- F. integritas referensi workbook

export function checkWorkbookReferences({ marketList, wipBlocks, menus }) {
  const dimension = "F. Integritas Workbook";
  const findings = [];
  const known = indexByName(
    [...marketList.map((i) => ({ name: i.name })), ...wipBlocks.map((b) => ({ name: b.name }))],
    (r) => r.name
  );

  const check = (refName, context, where) => {
    if (known.has(nkey(refName))) return;
    const near = bestNearMatch(
      refName,
      [...marketList.map((i) => i.name), ...wipBlocks.map((b) => b.name)]
    );
    findings.push(
      finding({
        severity: SEVERITY.DATA_QUALITY,
        dimension,
        entity: "reference",
        key: `${context} → ${refName}`,
        field: "unresolved reference",
        excelValue: where,
        nearMatch: near ? `${near.name} (${(near.score * 100).toFixed(0)}%)` : "",
        note: "Bahan tidak ditemukan di Market List maupun judul blok WIP",
      })
    );
  };

  for (const block of wipBlocks) {
    for (const comp of block.components) check(comp.name, block.name, `${block.sheet} baris ${comp.excelRow}`);
  }
  for (const menu of menus) {
    for (const element of menu.elements) check(element.name, menu.name, `${menu.sheet} baris ${element.excelRow}`);
  }

  // Judul yang muncul lebih dari sekali — resep dobel bikin ambigu mana yang dipakai.
  const reportDuplicates = (blocks, label) => {
    const groups = new Map();
    for (const b of blocks) {
      const key = nkey(b.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      findings.push(
        finding({
          severity: SEVERITY.DATA_QUALITY,
          dimension,
          entity: "duplicate",
          key: group[0].name,
          field: `judul ${label} duplikat`,
          excelValue: group.map((b) => `${b.sheet} baris ${b.excelRow}`).join(" ; "),
          note: `Muncul ${group.length}× di workbook`,
        })
      );
    }
  };
  reportDuplicates(wipBlocks, "WIP");
  reportDuplicates(menus, "menu");

  return findings;
}

// ----------------------------------------------------------- rename annotation

/**
 * Pasangkan MISSING_IN_DB ↔ EXTRA_IN_DB yang namanya mirip, supaya typo/rename
 * tidak terbaca sebagai "item baru + item usang".
 */
export function annotateRenames(findings) {
  const missing = findings.filter((f) => f.severity === SEVERITY.MISSING_IN_DB && f.field === "existence");
  const extra = findings.filter((f) => f.severity === SEVERITY.EXTRA_IN_DB && f.field === "existence");
  if (!missing.length || !extra.length) return findings;

  const extraNames = extra.map((f) => f.key);
  const used = new Set();

  for (const f of missing) {
    const near = bestNearMatch(f.key, extraNames.filter((n) => !used.has(n)));
    if (!near) continue;
    used.add(near.name);
    f.nearMatch = `${near.name} (${(near.score * 100).toFixed(0)}%)`;
    f.severity = SEVERITY.RENAME_CANDIDATE;
    f.note = `${f.note} — kemungkinan salah tulis / rename dari "${near.name}" di DB`.trim();
    const counterpart = extra.find((e) => e.key === near.name);
    if (counterpart) {
      counterpart.severity = SEVERITY.RENAME_CANDIDATE;
      counterpart.nearMatch = `${f.key} (${(near.score * 100).toFixed(0)}%)`;
      counterpart.note = `${counterpart.note} — kemungkinan versi lama dari "${f.key}" di workbook`.trim();
    }
  }
  return findings;
}
