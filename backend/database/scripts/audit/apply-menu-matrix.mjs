#!/usr/bin/env node
/**
 * Remediasi: selaraskan database dengan workbook "SIW - Menu Matrix".
 *
 *   node scripts/audit/apply-menu-matrix.mjs --allow-remote            # dry-run
 *   node scripts/audit/apply-menu-matrix.mjs --allow-remote --apply --confirm-remote
 *
 * Semua fase berjalan di DALAM SATU transaksi. Dry-run tetap mengeksekusi
 * seluruh perubahan lalu ROLLBACK, sehingga jumlah baris yang dilaporkan adalah
 * hasil nyata — bukan simulasi. Tanpa --apply, tidak ada yang di-commit.
 *
 * Fase:
 *   1  satuan besar + konversi_factor + harga_beli bahan baku
 *   2  perbaikan nama salah tulis, master bahan/WIP/produk yang belum ada
 *   3  BOM produk & resep WIP dibangun ulang dari workbook
 *   4  harga_modal, pos_products, dan backfill pos_order_items
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

import { parseMenuMatrix } from "./lib/parse-menu-matrix.mjs";
import {
  nkey,
  mapUnit,
  indexByName,
  similarity,
  compareRawMaterials,
  compareWip,
  compareProducts,
} from "./lib/compare.mjs";
import {
  SHEET_TO_WAREHOUSE,
  SHEET_TO_CATEGORY,
  WAREHOUSE_TO_CATEGORY,
  NEW_WAREHOUSES,
  noodlesWarehouse,
  stationFor,
} from "./lib/remediation-map.mjs";

const require = createRequire(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { parseHost, isLocalDatabaseUrl, sslForUrl } = require(
  path.join(BACKEND_ROOT, "database/scripts/pg-utils.js")
);
const { systemKategoriFromMarketCategory, resolveDefaultCoaForCategory, deriveLegacyCoaEnum } = require(
  path.join(BACKEND_ROOT, "database/seeders/lib/raw-material-coa-map.js")
);

const MONEY_TOL = 0.01;

// ------------------------------------------------------------------ util dasar

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    const full = path.join(BACKEND_ROOT, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
    }
  }
}

function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    if (m[2] === undefined) flags.add(m[1]);
    else opts[m[1]] = m[2];
  }
  return { flags, opts };
}

function resolveXlsx(explicit) {
  if (explicit) {
    const full = path.isAbsolute(explicit) ? explicit : path.join(BACKEND_ROOT, "..", explicit);
    if (!fs.existsSync(full)) throw new Error(`Workbook tidak ditemukan: ${full}`);
    return full;
  }
  const docs = path.join(BACKEND_ROOT, "..", "docs");
  const found = fs
    .readdirSync(docs)
    .filter((n) => /^SIW - Menu Matrix.*\.xlsx$/i.test(n) && !n.startsWith("~$"))
    .map((n) => ({ full: path.join(docs, n), mtime: fs.statSync(path.join(docs, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!found.length) throw new Error('Tidak ada "docs/SIW - Menu Matrix*.xlsx".');
  return found[0].full;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => num(v).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const near = (a, b, tol = MONEY_TOL) => Math.abs(num(a) - num(b)) <= tol;

/** Kode berurutan: MM-RM-0001, MM-WIP-0001, … */
function sequencer(prefix, lastKode, width = 4) {
  let n = 0;
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(lastKode || "");
  if (m) n = Number(m[1]);
  return () => {
    n += 1;
    return `${prefix}-${String(n).padStart(width, "0")}`;
  };
}

// ------------------------------------------------------------------- pencatatan

class Journal {
  constructor() {
    this.entries = [];
    this.skipped = [];
  }

  add(phase, action, target, detail) {
    this.entries.push({ phase, action, target, detail });
  }

  skip(phase, target, reason) {
    this.skipped.push({ phase, target, reason });
  }

  countsByPhase() {
    const out = new Map();
    for (const e of this.entries) {
      const key = `${e.phase}|${e.action}`;
      out.set(key, (out.get(key) || 0) + 1);
    }
    return out;
  }
}

// -------------------------------------------------------------- muat state DB

async function loadState(client, companyId) {
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  const units = await q("SELECT id, kode FROM item.units WHERE is_active = true");
  const unitByKode = new Map(units.map((u) => [u.kode, u.id]));

  const rawMaterials = await q(
    `SELECT rm.id, rm.kode, rm.nama, rm.kategori, rm.material_type, rm.konversi_factor,
            rm.harga_beli, rm.satuan_besar_id, rm.satuan_kecil_id,
            ub.kode AS satuan_besar, uk.kode AS satuan_kecil
       FROM item.raw_materials rm
       LEFT JOIN item.units ub ON ub.id = rm.satuan_besar_id
       LEFT JOIN item.units uk ON uk.id = rm.satuan_kecil_id
      WHERE rm.deleted_at IS NULL AND (rm.company_id = $1 OR rm.company_id IS NULL)`,
    [companyId]
  );

  const products = await q(
    `SELECT p.id, p.kode, p.nama, p.kategori, p.harga_jual, p.harga_modal, p.warehouse_id,
            p.station, p.satuan_id, w.code AS warehouse_code
       FROM item.products p
       LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
      WHERE p.deleted_at IS NULL AND (p.company_id = $1 OR p.company_id IS NULL)`,
    [companyId]
  );

  const warehouses = await q("SELECT id, code, name, branch_id FROM configuration.warehouses");
  const productCategories = await q("SELECT id, code FROM item.product_categories WHERE deleted_at IS NULL");
  const posCategories = await q("SELECT id, name FROM pos.pos_categories");
  const posProducts = await q("SELECT id, sku, name, source_product_id FROM pos.pos_products");

  return {
    unitByKode,
    rawMaterials,
    products,
    warehouses,
    warehouseByCode: new Map(warehouses.map((w) => [w.code, w])),
    productCategoryByCode: new Map(productCategories.map((c) => [c.code, c.id])),
    posCategoryByName: new Map(posCategories.map((c) => [c.name, c.id])),
    posProducts,
  };
}

/** Nama yang muncul lebih dari sekali tidak bisa dicocokkan secara aman. */
function duplicateNames(records, nameOf) {
  const counts = new Map();
  for (const r of records) {
    const k = nkey(nameOf(r));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
}


/** Satuan yang dipakai workbook tapi belum ada di master dibuat sekali di sini. */
const UNIT_NAMES = { JAR: "Jar", IKAT: "Ikat", CAN: "Kaleng" };

async function ensureUnit(client, state, kode, journal) {
  if (!kode) return null;
  const existing = state.unitByKode.get(kode);
  if (existing) return existing;
  const { rows } = await client.query(
    `INSERT INTO item.units (kode, nama, tipe, deskripsi, is_active)
     VALUES ($1, $2, 'BESAR', 'Dibuat oleh remediasi Menu Matrix', true)
     RETURNING id`,
    [kode, UNIT_NAMES[kode] || kode]
  );
  state.unitByKode.set(kode, rows[0].id);
  journal.add(2, "buat satuan", kode, "dipakai di Market List tapi belum ada di item.units");
  return rows[0].id;
}

// ------------------------------- FASE 1 — satuan besar, konversi, harga bahan

async function phase1(client, state, parsed, journal) {
  const dupes = duplicateNames(state.rawMaterials, (r) => r.nama);
  const dbIndex = indexByName(state.rawMaterials, (r) => r.nama);

  for (const item of parsed.marketList) {
    if (item.isWip) continue;
    const key = nkey(item.name);
    if (dupes.has(key)) {
      journal.skip(1, item.name, "nama ganda di database — tidak bisa dicocokkan otomatis");
      continue;
    }
    const rm = dbIndex.get(key);
    if (!rm) continue; // ditangani fase 2

    const bigKode = mapUnit(item.purchaseUom);
    const weight = item.weight;
    const unitCost = item.unitCost;

    // Setiap alasan gagal dicatat — kalau tidak, baris seperti "Lada Bubuk"
    // (Purchase UOM kosong) hilang diam-diam padahal konversinya salah.
    if (item.purchaseUom && !bigKode) {
      journal.skip(1, item.name, `Purchase UOM "${item.purchaseUom}" tidak ada padanannya di item.units`);
      continue;
    }
    if (!item.purchaseUom) {
      if (num(weight) > 1) {
        journal.skip(
          1,
          item.name,
          `Market List tidak mengisi Purchase UOM padahal isi kemasan ${weight} — konversi tidak bisa dibetulkan otomatis`
        );
      }
      continue;
    }
    if (weight === null) {
      journal.skip(1, item.name, "Market List tidak mengisi Weight — konversi tidak bisa dihitung");
      continue;
    }
    if (unitCost === null) {
      journal.skip(1, item.name, "Market List tidak mengisi Unit Cost");
      continue;
    }
    const bigId = await ensureUnit(client, state, bigKode, journal);
    if (!bigId) {
      journal.skip(1, item.name, `satuan "${bigKode}" tidak terdaftar di item.units`);
      continue;
    }

    // Pemeriksaan penerimaan: setelah diubah, biaya per satuan kecil HARUS sama
    // dengan "Unit Price / Unit" di Market List. Kalau tidak, jangan disentuh.
    const projected = weight > 0 ? unitCost / weight : null;
    if (projected === null || !near(projected, item.unitPrice)) {
      journal.skip(
        1,
        item.name,
        `hasilnya tidak konsisten (${money(unitCost)}/${weight} = ${money(projected)} vs Market List ${money(item.unitPrice)})`
      );
      continue;
    }

    // Market List yang kosong harganya tidak boleh menghapus harga yang sudah ada.
    const keepPrice = unitCost === 0 && num(rm.harga_beli) > 0;
    if (keepPrice) journal.skip(1, item.name, "Market List tidak mencantumkan harga — harga lama dipertahankan");
    const targetPrice = keepPrice ? num(rm.harga_beli) : unitCost;

    const changes = [];
    if (rm.satuan_besar_id !== bigId) changes.push(`satuan_besar ${rm.satuan_besar || "-"} → ${bigKode}`);
    if (!near(num(rm.konversi_factor), weight, 0.0001)) changes.push(`konversi ${rm.konversi_factor} → ${weight}`);
    if (!near(num(rm.harga_beli), targetPrice)) changes.push(`harga_beli ${money(rm.harga_beli)} → ${money(targetPrice)}`);
    if (!changes.length) continue;

    await client.query(
      `UPDATE item.raw_materials
          SET satuan_besar_id = $2, konversi_factor = $3, harga_beli = $4, updated_at = now()
        WHERE id = $1`,
      [rm.id, bigId, weight, targetPrice]
    );
    rm.satuan_besar_id = bigId;
    rm.satuan_besar = bigKode;
    rm.konversi_factor = weight;
    rm.harga_beli = targetPrice;
    journal.add(
      1,
      "update bahan baku",
      `${rm.kode} ${rm.nama}`,
      `${changes.join(", ")} — biaya/satuan → ${money(targetPrice / weight)}`
    );
  }
}

// --------------------- FASE 2 — nama salah tulis + master yang belum ada

async function phase2Renames(client, state, parsed, journal) {
  const rename = async (records, nameOf, table, workbookNames, phaseLabel) => {
    const wbSet = new Set(workbookNames.map(nkey));
    const dbSet = new Set(records.map((r) => nkey(nameOf(r))));
    const orphanDb = records.filter((r) => !wbSet.has(nkey(nameOf(r))));
    const orphanWb = workbookNames.filter((n) => !dbSet.has(nkey(n)));

    const used = new Set();
    for (const row of orphanDb) {
      let best = null;
      let bestScore = 0;
      for (const wbName of orphanWb) {
        if (used.has(wbName)) continue;
        const score = similarity(nameOf(row), wbName);
        if (score > bestScore) {
          bestScore = score;
          best = wbName;
        }
      }
      if (!best || bestScore < 0.88) continue;
      if (dbSet.has(nkey(best))) continue; // nama tujuan sudah dipakai baris lain
      used.add(best);
      await client.query(`UPDATE ${table} SET nama = $2, updated_at = now() WHERE id = $1`, [row.id, best]);
      journal.add(2, phaseLabel, row.kode || row.id, `"${nameOf(row)}" → "${best}" (${(bestScore * 100).toFixed(0)}%)`);
      row.nama = best;
    }
  };

  await rename(
    state.rawMaterials.filter((r) => r.material_type === "PURCHASED"),
    (r) => r.nama,
    "item.raw_materials",
    parsed.marketList.filter((i) => !i.isWip).map((i) => i.name),
    "rename bahan baku"
  );
  await rename(
    state.rawMaterials.filter((r) => r.material_type === "WIP"),
    (r) => r.nama,
    "item.raw_materials",
    parsed.wipBlocks.map((b) => b.name),
    "rename WIP"
  );
  await rename(
    state.products,
    (p) => p.nama,
    "item.products",
    parsed.menus.map((m) => m.name),
    "rename produk"
  );
}

async function phase2Masters(client, state, parsed, scope, journal) {
  const rmSeq = sequencer(
    "MM-RM",
    (await client.query("SELECT max(kode) mx FROM item.raw_materials WHERE kode LIKE 'MM-RM-%'")).rows[0].mx
  );
  const wipSeq = sequencer(
    "MM-WIP",
    (await client.query("SELECT max(kode) mx FROM item.raw_materials WHERE kode LIKE 'MM-WIP-%'")).rows[0].mx
  );

  const insertRm = async ({ kode, nama, kategori, besarKode, kecilKode, konversi, hargaBeli, materialType }) => {
    const coa = resolveDefaultCoaForCategory(kategori);
    const legacyCoa = deriveLegacyCoaEnum({ ...coa, coa_rnd: null });
    const besarId = await ensureUnit(client, state, besarKode, journal);
    const kecilId = await ensureUnit(client, state, kecilKode, journal);
    const { rows } = await client.query(
      `INSERT INTO item.raw_materials
         (kode, nama, kategori, satuan_besar_id, satuan_kecil_id, konversi_factor, harga_beli,
          material_type, is_active, company_id, branch_id, coa, coa_asset, coa_production)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13)
       RETURNING id, kode, nama, kategori, material_type, konversi_factor, harga_beli,
                 satuan_besar_id, satuan_kecil_id`,
      [
        kode, nama, kategori, besarId, kecilId, konversi, hargaBeli, materialType,
        scope.company_id, scope.branch_id, legacyCoa, coa.coa_asset || null, coa.coa_production || null,
      ]
    );
    const row = { ...rows[0], satuan_besar: besarKode, satuan_kecil: kecilKode };
    state.rawMaterials.push(row);
    return row;
  };

  // --- bahan baku dari Market List yang belum ada
  let dbIndex = indexByName(state.rawMaterials, (r) => r.nama);
  for (const item of parsed.marketList) {
    if (item.isWip || dbIndex.has(nkey(item.name))) continue;
    const kecilKode = mapUnit(item.uom);
    const besarKode = mapUnit(item.purchaseUom) || kecilKode;
    if (!kecilKode) {
      journal.skip(2, item.name, `UOM "${item.uom}" tidak ada padanannya di item.units`);
      continue;
    }
    const konversi = item.weight && item.weight > 0 ? item.weight : 1;
    const row = await insertRm({
      kode: rmSeq(),
      nama: item.name,
      kategori: systemKategoriFromMarketCategory(item.category) || "LAIN",
      besarKode,
      kecilKode,
      konversi,
      hargaBeli: item.unitCost ?? 0,
      materialType: "PURCHASED",
    });
    journal.add(2, "buat bahan baku", `${row.kode} ${row.nama}`, `${besarKode}/${kecilKode} konversi ${konversi}, harga ${money(item.unitCost)}`);
    dbIndex = indexByName(state.rawMaterials, (r) => r.nama);
  }

  // --- WIP dari sheet WIP yang belum ada (yang sudah ada, biayanya disegarkan)
  for (const block of parsed.wipBlocks) {
    const existingWip = dbIndex.get(nkey(block.name));
    if (existingWip) {
      if (block.unitCost !== null && !near(num(existingWip.harga_beli), block.unitCost)) {
        await client.query(
          "UPDATE item.raw_materials SET harga_beli = $2, updated_at = now() WHERE id = $1",
          [existingWip.id, block.unitCost]
        );
        journal.add(
          2,
          "harga WIP",
          `${existingWip.kode} ${existingWip.nama}`,
          `${money(existingWip.harga_beli)} → ${money(block.unitCost)} per satuan`
        );
        existingWip.harga_beli = block.unitCost;
      }
      continue;
    }
    const row = await insertRm({
      kode: wipSeq(),
      nama: block.name,
      kategori: "LAIN",
      besarKode: "PORSI",
      kecilKode: "PORSI",
      konversi: 1,
      hargaBeli: block.unitCost ?? 0,
      materialType: "WIP",
    });
    journal.add(2, "buat WIP", `${row.kode} ${row.nama}`, `batch ${block.batchQty} ${block.batchUom}, biaya/satuan ${money(block.unitCost)}`);
    dbIndex = indexByName(state.rawMaterials, (r) => r.nama);
  }

  // --- bahan yang dipakai resep tapi tidak terdaftar di Market List sekalipun
  const referenced = new Map();
  for (const block of parsed.wipBlocks) {
    for (const comp of block.components) {
      if (!referenced.has(nkey(comp.name))) referenced.set(nkey(comp.name), { name: comp.name, uom: comp.uom, cost: comp.unitPrice });
    }
  }
  for (const menu of parsed.menus) {
    for (const el of menu.elements) {
      if (!referenced.has(nkey(el.name))) referenced.set(nkey(el.name), { name: el.name, uom: el.uom, cost: el.elementCost });
    }
  }
  for (const [key, ref] of referenced) {
    if (dbIndex.has(key)) continue;
    const kecilKode = mapUnit(ref.uom);
    if (!kecilKode) {
      journal.skip(2, ref.name, `dipakai di resep tapi UOM "${ref.uom}" tidak dikenali`);
      continue;
    }
    const row = await insertRm({
      kode: rmSeq(),
      nama: ref.name,
      kategori: "LAIN",
      besarKode: kecilKode,
      kecilKode,
      konversi: 1,
      hargaBeli: ref.cost ?? 0,
      materialType: "PURCHASED",
    });
    journal.add(
      2,
      "buat bahan (dari resep)",
      `${row.kode} ${row.nama}`,
      `tidak ada di Market List — satuan ${kecilKode}, biaya ${money(ref.cost)} diambil dari baris resep`
    );
    dbIndex = indexByName(state.rawMaterials, (r) => r.nama);
  }
}

async function phase2Products(client, state, parsed, scope, journal) {
  const porsiId = state.unitByKode.get("PORSI");
  if (!porsiId) throw new Error('Satuan "PORSI" tidak ada di item.units.');

  // Warehouse baru untuk sheet yang belum punya stall.
  for (const [sheetKey, def] of Object.entries(NEW_WAREHOUSES)) {
    if (!parsed.stallSheets.some((s) => nkey(s) === nkey(sheetKey))) continue;
    if (state.warehouseByCode.has(def.code)) continue;
    const { rows } = await client.query(
      `INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
       VALUES ($1,$2,$3,false,true) RETURNING id, code, name, branch_id`,
      [scope.branch_id, def.name, def.code]
    );
    state.warehouseByCode.set(def.code, rows[0]);
    journal.add(2, "buat warehouse", `${def.code} ${def.name}`, "stall belum ada di configuration.warehouses");
  }

  const resolveWarehouse = (menu) => {
    const sheetKey = nkey(menu.sheet);
    if (/noodles/.test(sheetKey)) return noodlesWarehouse(menu.name);
    const mapped = SHEET_TO_WAREHOUSE[Object.keys(SHEET_TO_WAREHOUSE).find((k) => nkey(k) === sheetKey)];
    if (mapped) return mapped;
    const created = NEW_WAREHOUSES[Object.keys(NEW_WAREHOUSES).find((k) => nkey(k) === sheetKey)];
    return created ? created.code : null;
  };

  const resolveCategory = (menu, warehouseCode) => {
    if (WAREHOUSE_TO_CATEGORY[warehouseCode]) return WAREHOUSE_TO_CATEGORY[warehouseCode];
    const sheetKey = nkey(menu.sheet);
    const found = Object.keys(SHEET_TO_CATEGORY).find((k) => nkey(k) === sheetKey);
    return found ? SHEET_TO_CATEGORY[found] : "MAIN";
  };

  const ensureProductCategory = async (code) => {
    if (state.productCategoryByCode.has(code)) return state.productCategoryByCode.get(code);
    const { rows } = await client.query(
      `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
       VALUES ($1,$2,'Dibuat oleh remediasi Menu Matrix',$3,true) RETURNING id`,
      [code, code.replace(/-/g, " "), scope.company_id]
    );
    state.productCategoryByCode.set(code, rows[0].id);
    journal.add(2, "buat kategori produk", code, "belum ada di item.product_categories");
    return rows[0].id;
  };

  // Nomor urut produk bersifat global (MM-<STALL>-NNN), lanjutkan dari yang terbesar.
  const maxSuffix = (
    await client.query(
      "SELECT max(substring(kode from '(\\d+)$')::int) mx FROM item.products WHERE kode LIKE 'MM-STALL-%'"
    )
  ).rows[0].mx;
  let counter = Number(maxSuffix || 0);

  const dupes = duplicateNames(state.products, (p) => p.nama);
  let dbIndex = indexByName(state.products, (p) => p.nama);

  for (const menu of parsed.menus) {
    const key = nkey(menu.name);
    if (dupes.has(key)) {
      journal.skip(2, menu.name, "ada lebih dari satu produk dengan nama ini di database");
      continue;
    }
    if (dbIndex.has(key)) continue;

    const warehouseCode = resolveWarehouse(menu);
    const warehouse = warehouseCode ? state.warehouseByCode.get(warehouseCode) : null;
    if (!warehouse) {
      journal.skip(2, menu.name, `warehouse untuk sheet "${menu.sheet}" tidak bisa ditentukan`);
      continue;
    }
    const categoryCode = resolveCategory(menu, warehouseCode);
    await ensureProductCategory(categoryCode);

    counter += 1;
    const kode = `MM-${warehouseCode}-${String(counter).padStart(3, "0")}`;
    const station = stationFor(menu.sheet, categoryCode);
    const hargaJual = menu.sellingPrice ?? 0;

    const { rows } = await client.query(
      `INSERT INTO item.products
         (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, is_active,
          company_id, branch_id, warehouse_id, production_output_type, station)
       VALUES ($1,$2,$3,$4,$5,$6,0,true,$7,$8,$9,'FINISHED_GOOD',$10)
       RETURNING id, kode, nama, kategori, harga_jual, harga_modal, warehouse_id, station, satuan_id`,
      [
        kode, menu.name, menu.description || null, categoryCode, porsiId, hargaJual,
        scope.company_id, scope.branch_id, warehouse.id, station,
      ]
    );
    const row = { ...rows[0], warehouse_code: warehouseCode };
    state.products.push(row);
    dbIndex = indexByName(state.products, (p) => p.nama);
    journal.add(2, "buat produk", `${kode} ${menu.name}`, `${warehouseCode} · ${categoryCode} · station ${station} · harga ${money(hargaJual)}`);
  }
}


/**
 * Satu bahan bisa muncul dua kali dalam satu resep (mis. dipakai di dua tahap).
 * Tabel BOM unik per (induk, komponen), jadi baris kembar digabung qty-nya.
 */
function mergeBomLines(lines, onMerge) {
  const merged = new Map();
  for (const line of lines) {
    const existing = merged.get(line.rm.id);
    if (!existing) {
      merged.set(line.rm.id, { ...line });
      continue;
    }
    existing.qty = num(existing.qty) + num(line.qty);
    if (onMerge) onMerge(line, existing.qty);
  }
  return [...merged.values()];
}

// ------------------------- FASE 3 — BOM produk & resep WIP dibangun ulang

async function phase3(client, state, parsed, journal) {
  const rmIndex = indexByName(state.rawMaterials, (r) => r.nama);
  const rmDupes = duplicateNames(state.rawMaterials, (r) => r.nama);
  const prodIndex = indexByName(state.products, (p) => p.nama);
  const prodDupes = duplicateNames(state.products, (p) => p.nama);

  const resolveComponent = (name, phase, context) => {
    const key = nkey(name);
    if (rmDupes.has(key)) {
      journal.skip(phase, `${context} → ${name}`, "nama bahan ganda di database");
      return null;
    }
    const rm = rmIndex.get(key);
    if (!rm) {
      journal.skip(phase, `${context} → ${name}`, "bahan tidak ada di item.raw_materials");
      return null;
    }
    return rm;
  };

  // --- resep WIP
  for (const block of parsed.wipBlocks) {
    const output = resolveComponent(block.name, 3, "resep WIP");
    if (!output) continue;

    const lines = [];
    for (const comp of block.components) {
      const rm = resolveComponent(comp.name, 3, block.name);
      if (!rm) continue;
      // Constraint DB menuntut qty > 0; baris resep tanpa angka adalah lubang data
      // di workbook, bukan sesuatu yang boleh ditebak.
      if (!(num(comp.use) > 0)) {
        journal.skip(3, `${block.name} → ${comp.name}`, "qty kosong di workbook");
        continue;
      }
      const unitKode = mapUnit(comp.uom) || rm.satuan_kecil;
      const satuanId = state.unitByKode.get(unitKode) || rm.satuan_kecil_id;
      lines.push({ rm, qty: comp.use, satuanId, unitKode });
    }
    const finalLines = mergeBomLines(lines, (line, qty) =>
      journal.add(3, "gabung baris kembar", `${block.name} → ${line.rm.nama}`, `muncul >1× di workbook, qty digabung jadi ${qty}`)
    );
    if (!finalLines.length) continue;

    const before = await client.query(
      "SELECT count(*)::int n FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1 AND is_active",
      [output.id]
    );
    await client.query("DELETE FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1", [output.id]);
    for (const line of finalLines) {
      await client.query(
        `INSERT INTO manufacturing.raw_material_bom_items
           (output_raw_material_id, component_raw_material_id, qty_required, satuan_id, waste_factor, is_active)
         VALUES ($1,$2,$3,$4,0,true)`,
        [output.id, line.rm.id, line.qty, line.satuanId]
      );
    }
    journal.add(3, "resep WIP", `${output.kode} ${output.nama}`, `${before.rows[0].n} → ${finalLines.length} komponen`);
  }

  // --- BOM produk
  for (const menu of parsed.menus) {
    const key = nkey(menu.name);
    if (prodDupes.has(key)) {
      journal.skip(3, menu.name, "nama produk ganda di database");
      continue;
    }
    const product = prodIndex.get(key);
    if (!product) {
      journal.skip(3, menu.name, "produk tidak ada di item.products");
      continue;
    }

    const lines = [];
    for (const el of menu.elements) {
      const rm = resolveComponent(el.name, 3, menu.name);
      if (!rm) continue;
      if (!(num(el.portionUsed) > 0)) {
        journal.skip(3, `${menu.name} → ${el.name}`, "qty kosong di workbook");
        continue;
      }
      const unitKode = mapUnit(el.uom) || rm.satuan_kecil;
      const satuanId = state.unitByKode.get(unitKode) || rm.satuan_kecil_id;
      lines.push({ rm, qty: el.portionUsed, satuanId });
    }
    const finalLines = mergeBomLines(lines, (line, qty) =>
      journal.add(3, "gabung baris kembar", `${menu.name} → ${line.rm.nama}`, `muncul >1× di workbook, qty digabung jadi ${qty}`)
    );
    if (!finalLines.length) continue;

    const before = await client.query(
      "SELECT count(*)::int n FROM manufacturing.bom_items WHERE product_id = $1 AND is_active",
      [product.id]
    );
    await client.query("DELETE FROM manufacturing.bom_items WHERE product_id = $1", [product.id]);
    for (const line of finalLines) {
      await client.query(
        `INSERT INTO manufacturing.bom_items
           (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
         VALUES ($1,$2,$3,$4,0,true)`,
        [product.id, line.rm.id, line.qty, line.satuanId]
      );
    }
    journal.add(3, "BOM produk", `${product.kode} ${product.nama}`, `${before.rows[0].n} → ${finalLines.length} baris`);
  }
}

// ---------------- FASE 4 — harga_modal, pos_products, backfill pos_order_items

async function phase4(client, state, parsed, scope, journal) {
  // --- harga_modal = Σ(qty × biaya per satuan kecil), konvensi yang sudah dipakai DB & API COGS
  const cogs = await client.query(
    `SELECT b.product_id,
            sum(b.qty_required * rm.harga_beli / NULLIF(rm.konversi_factor, 0)) AS direct_cost
       FROM manufacturing.bom_items b
       JOIN item.raw_materials rm ON rm.id = b.raw_material_id
      WHERE b.is_active
      GROUP BY b.product_id`
  );
  const cogsByProduct = new Map(cogs.rows.map((r) => [r.product_id, num(r.direct_cost)]));
  const menuIndex = indexByName(parsed.menus, (m) => m.name);

  for (const product of state.products) {
    const direct = cogsByProduct.get(product.id);
    const menu = menuIndex.get(nkey(product.nama));
    const hargaJual = menu?.sellingPrice ?? num(product.harga_jual);
    const newModal = direct === undefined ? num(product.harga_modal) : direct;
    // markup_persen NOT NULL — produk tanpa HPP dicatat 0, bukan null.
    const markup = newModal > 0 ? Math.round(((hargaJual - newModal) / newModal) * 10000) / 100 : 0;

    const modalChanged = !near(num(product.harga_modal), newModal);
    const jualChanged = !near(num(product.harga_jual), hargaJual);
    if (!modalChanged && !jualChanged) continue;

    await client.query(
      `UPDATE item.products SET harga_modal = $2, harga_jual = $3, markup_persen = $4, updated_at = now() WHERE id = $1`,
      [product.id, newModal, hargaJual, markup]
    );
    journal.add(
      4,
      "harga produk",
      `${product.kode} ${product.nama}`,
      `harga_modal ${money(product.harga_modal)} → ${money(newModal)}` +
        (jualChanged ? `, harga_jual ${money(product.harga_jual)} → ${money(hargaJual)}` : "")
    );
    product.harga_modal = newModal;
    product.harga_jual = hargaJual;
  }

  // --- sinkron ke katalog POS
  const posBySource = new Map(state.posProducts.filter((p) => p.source_product_id).map((p) => [p.source_product_id, p]));
  const posBySku = new Map(state.posProducts.map((p) => [p.sku, p]));

  const ensurePosCategory = async (name) => {
    if (state.posCategoryByName.has(name)) return state.posCategoryByName.get(name);
    const { rows } = await client.query(
      "INSERT INTO pos.pos_categories (name, is_active) VALUES ($1, true) RETURNING id",
      [name]
    );
    state.posCategoryByName.set(name, rows[0].id);
    journal.add(4, "buat kategori POS", name, "belum ada di pos.pos_categories");
    return rows[0].id;
  };

  for (const product of state.products) {
    const sku = `PUR-${product.kode}`;
    const existing = posBySource.get(product.id) || posBySku.get(sku);
    const categoryId = await ensurePosCategory(product.kategori);

    if (existing) {
      const { rowCount } = await client.query(
        `UPDATE pos.pos_products
            SET base_price = $2, cost_price = $3, name = $4, source_product_id = $5,
                station = $6, category_id = COALESCE(category_id, $7), updated_at = now()
          WHERE id = $1
            AND (base_price IS DISTINCT FROM $2 OR cost_price IS DISTINCT FROM $3
                 OR name IS DISTINCT FROM $4 OR source_product_id IS DISTINCT FROM $5)`,
        [existing.id, product.harga_jual, product.harga_modal, product.nama, product.id, product.station, categoryId]
      );
      if (rowCount) {
        journal.add(4, "sync POS", `${existing.sku} ${product.nama}`, `cost_price → ${money(product.harga_modal)}, base_price → ${money(product.harga_jual)}`);
      }
      continue;
    }

    await client.query(
      `INSERT INTO pos.pos_products
         (sku, name, description, category_id, base_price, cost_price, is_active, is_available,
          inventory_tracking, station, source_product_id)
       VALUES ($1,$2,NULL,$3,$4,$5,true,true,false,$6,$7)
       ON CONFLICT (sku) DO UPDATE
         SET base_price = EXCLUDED.base_price, cost_price = EXCLUDED.cost_price,
             source_product_id = EXCLUDED.source_product_id, updated_at = now()`,
      [sku, product.nama, categoryId, product.harga_jual, product.harga_modal, product.station, product.id]
    );
    journal.add(4, "buat produk POS", `${sku} ${product.nama}`, `harga ${money(product.harga_jual)}, HPP ${money(product.harga_modal)}`);
  }

  // --- backfill riwayat pos_order_items
  if (process.env.DEBUG_BACKFILL) {
    const probe = await client.query(
      `SELECT count(*)::int n,
              count(*) FILTER (WHERE pp.cost_price IS NULL)::int cost_null,
              count(DISTINCT pp.id)::int produk
         FROM pos.pos_order_items oi
         JOIN pos.pos_products pp ON pp.id = oi.product_id
        WHERE oi.cost_price IS DISTINCT FROM pp.cost_price`
    );
    console.log("DEBUG sebelum backfill:", JSON.stringify(probe.rows[0]));
  }
  const backfill = await client.query(
    `WITH src AS (
       -- product_sku pada baris order adalah snapshot SKU lama; yang stabil adalah
     -- product_id (terisi & cocok untuk seluruh 3.172 baris).
     SELECT oi.id, pp.cost_price AS new_cost, oi.quantity, oi.total_amount,
              oi.cost_price AS old_cost
         FROM pos.pos_order_items oi
         JOIN pos.pos_products pp ON pp.id = oi.product_id
        WHERE pp.cost_price IS NOT NULL
          AND oi.cost_price IS DISTINCT FROM pp.cost_price
     )
     UPDATE pos.pos_order_items oi
        SET cost_price = src.new_cost,
            cost_total = src.new_cost * src.quantity,
            gross_profit = src.total_amount - (src.new_cost * src.quantity),
            -- gross_margin_pct NOT NULL, numeric(8,2): dijepit agar tidak overflow
            -- pada baris lama yang HPP-nya masih jauh di atas harga jual.
            gross_margin_pct = CASE WHEN src.total_amount > 0
                 THEN greatest(-999999.99, least(999999.99,
                      round((((src.total_amount - (src.new_cost * src.quantity)) / src.total_amount) * 100)::numeric, 2)))
                 ELSE 0 END,
            updated_at = now()
       FROM src
      WHERE oi.id = src.id
      RETURNING oi.id`
  );
  if (backfill.rowCount) {
    journal.add(4, "backfill POS", "pos_order_items", `${backfill.rowCount} baris riwayat dihitung ulang`);
  }
}


/** Dampak ke laporan profit POS — angka yang paling terasa oleh bisnis. */
const POS_SUMMARY_SQL = `
  SELECT round(sum(total_amount)::numeric, 0) AS omzet,
         round(sum(coalesce(cost_total, 0))::numeric, 0) AS hpp,
         count(*) FILTER (WHERE cost_price > unit_price)::int AS hpp_di_atas_harga,
         count(*) FILTER (WHERE coalesce(cost_price, 0) = 0)::int AS hpp_kosong
    FROM pos.pos_order_items`;

// ------------------------------------------------------------------ verifikasi

/**
 * Jalankan ulang pembanding audit terhadap state DI DALAM transaksi yang sama,
 * sebelum COMMIT/ROLLBACK. Ini bukti bahwa perubahan benar-benar menutup selisih —
 * bukan sekadar laporan "sekian baris di-update".
 */
async function verifyAgainstWorkbook(client, companyId, parsed) {
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  const rawMaterials = await q(
    `SELECT rm.id, rm.kode, rm.nama, rm.kategori, rm.material_type, rm.konversi_factor,
            rm.harga_beli, ub.kode AS satuan_besar, uk.kode AS satuan_kecil
       FROM item.raw_materials rm
       LEFT JOIN item.units ub ON ub.id = rm.satuan_besar_id
       LEFT JOIN item.units uk ON uk.id = rm.satuan_kecil_id
      WHERE rm.deleted_at IS NULL AND (rm.company_id = $1 OR rm.company_id IS NULL)`,
    [companyId]
  );
  const products = await q(
    `SELECT p.id, p.kode, p.nama, p.kategori, p.harga_jual, p.harga_modal
       FROM item.products p
      WHERE p.deleted_at IS NULL AND (p.company_id = $1 OR p.company_id IS NULL)`,
    [companyId]
  );
  const bomRows = await q(
    `SELECT b.id, b.product_id, b.qty_required, rm.nama AS raw_material_nama, u.kode AS satuan
       FROM manufacturing.bom_items b
       JOIN item.raw_materials rm ON rm.id = b.raw_material_id
       LEFT JOIN item.units u ON u.id = b.satuan_id
      WHERE b.is_active`
  );
  const rmBomRows = await q(
    `SELECT b.id, b.output_raw_material_id, b.qty_required, rm.nama AS component_nama, u.kode AS satuan
       FROM manufacturing.raw_material_bom_items b
       JOIN item.raw_materials rm ON rm.id = b.component_raw_material_id
       LEFT JOIN item.units u ON u.id = b.satuan_id
      WHERE b.is_active`
  );

  const groupBy = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row[key])) map.set(row[key], []);
      map.get(row[key]).push(row);
    }
    return map;
  };

  const raw = compareRawMaterials({
    marketList: parsed.marketList,
    dbRawMaterials: rawMaterials,
    systemKategoriFromMarketCategory,
  });
  const wip = compareWip({
    marketList: parsed.marketList,
    wipBlocks: parsed.wipBlocks,
    dbRawMaterials: rawMaterials,
    dbRawMaterialBom: groupBy(rmBomRows, "output_raw_material_id"),
  });
  const prod = compareProducts({
    menus: parsed.menus,
    summary: parsed.summary,
    dbProducts: products,
    dbBom: groupBy(bomRows, "product_id"),
    dbRawMaterials: rawMaterials,
  });

  return [
    ["A. Bahan Baku", raw],
    ["B. Master WIP", wip.master],
    ["C. Resep WIP", wip.bom],
    ["D. Produk", prod.product],
    ["E. BOM Produk", prod.bom],
  ];
}

// ------------------------------------------------------------------- pelaporan

function report(journal, { apply }) {
  const counts = journal.countsByPhase();
  const names = { 1: "Fase 1 — satuan & konversi", 2: "Fase 2 — nama & master baru", 3: "Fase 3 — BOM & resep", 4: "Fase 4 — COGS & POS" };

  console.log("\n" + "=".repeat(72));
  console.log(apply ? "PERUBAHAN DITERAPKAN (COMMIT)" : "DRY-RUN — semua perubahan di-ROLLBACK, database tidak berubah");
  console.log("=".repeat(72));

  for (const phase of [1, 2, 3, 4]) {
    const rows = [...counts].filter(([k]) => k.startsWith(`${phase}|`));
    if (!rows.length) continue;
    console.log(`\n${names[phase]}`);
    for (const [k, n] of rows.sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(5)}  ${k.split("|")[1]}`);
    }
  }

  console.log(`\nTotal perubahan: ${journal.entries.length}`);
  if (journal.skipped.length) {
    const grouped = new Map();
    for (const s of journal.skipped) {
      const k = s.reason.replace(/"[^"]*"/g, '"…"').replace(/\(.*\)/, "(…)");
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(s.target);
    }
    console.log(`\nDilewati (${journal.skipped.length}) — perlu keputusan manual:`);
    for (const [reason, targets] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`   ${String(targets.length).padStart(5)}  ${reason}`);
      console.log(`          ${targets.slice(0, 4).join(", ")}${targets.length > 4 ? ", …" : ""}`);
    }
  }
}

function writeJournal(journal, outDir, verification) {
  fs.mkdirSync(outDir, { recursive: true });
  const cell = (v) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = ["phase,action,target,detail"];
  for (const e of journal.entries) lines.push([e.phase, e.action, e.target, e.detail].map(cell).join(","));
  fs.writeFileSync(path.join(outDir, "perubahan.csv"), `﻿${lines.join("\n")}\n`, "utf8");

  const skip = ["phase,target,reason"];
  for (const s of journal.skipped) skip.push([s.phase, s.target, s.reason].map(cell).join(","));
  fs.writeFileSync(path.join(outDir, "dilewati.csv"), `﻿${skip.join("\n")}\n`, "utf8");

  if (verification) {
    const rows = ["dimension,severity,entity,key,field,excel_value,db_value,delta,note"];
    for (const [, findings] of verification) {
      for (const f of findings) {
        rows.push(
          [f.dimension, f.severity, f.entity, f.key, f.field, f.excelValue, f.dbValue, f.delta, f.note]
            .map(cell)
            .join(",")
        );
      }
    }
    fs.writeFileSync(path.join(outDir, "sisa-selisih.csv"), `\ufeff${rows.join("\n")}\n`, "utf8");
  }
}

// ------------------------------------------------------------------------ main

async function main() {
  loadEnv();
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const apply = flags.has("apply");

  const xlsxPath = resolveXlsx(opts.xlsx);
  const parsed = parseMenuMatrix(xlsxPath);
  console.log(`Workbook : ${path.relative(BACKEND_ROOT, xlsxPath)}`);
  console.log(
    `Parsed   : ${parsed.marketList.length} Market List · ${parsed.wipBlocks.length} WIP · ${parsed.menus.length} menu`
  );

  const dbUrl = opts.db || process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("AUDIT_DATABASE_URL / DATABASE_URL belum diset.");
  const host = parseHost(dbUrl);
  if (!isLocalDatabaseUrl(dbUrl) && !flags.has("allow-remote")) {
    throw new Error(`REFUSED: target "${host}" bukan localhost. Tambahkan --allow-remote.`);
  }
  if (apply && !isLocalDatabaseUrl(dbUrl) && !flags.has("confirm-remote")) {
    throw new Error(`REFUSED: --apply ke "${host}" butuh --confirm-remote.`);
  }

  const phases = new Set((opts.phase || "1,2,3,4").split(",").map((s) => Number(s.trim())));
  const client = new pg.Client({ connectionString: dbUrl, ssl: sslForUrl(dbUrl) });
  await client.connect();
  const journal = new Journal();
  let verification = null;
  let posBefore = null;
  let posAfter = null;

  try {
    await client.query("SET SESSION statement_timeout = '600s'");
    const { rows: dbRows } = await client.query("SELECT current_database() AS db");
    console.log(`Database : ${host} / ${dbRows[0].db}`);
    console.log(`Mode     : ${apply ? "APPLY (akan di-COMMIT)" : "DRY-RUN (akan di-ROLLBACK)"}`);
    console.log(`Fase     : ${[...phases].join(", ")}`);

    const companyCode = opts.company || process.env.SEED_COMPANY_CODE || "SULU";
    const branchCode = opts.branch || process.env.SEED_BRANCH_CODE || "SULU-DAGO";
    const { rows: scopeRows } = await client.query(
      `SELECT c.id AS company_id, b.id AS branch_id
         FROM configuration.companies c
         LEFT JOIN configuration.branches b ON b.company_id = c.id AND b.code = $2
        WHERE c.code = $1 LIMIT 1`,
      [companyCode, branchCode]
    );
    if (!scopeRows[0]) throw new Error(`Company "${companyCode}" tidak ditemukan.`);
    const scope = scopeRows[0];

    posBefore = (await client.query(POS_SUMMARY_SQL)).rows[0];

    await client.query("BEGIN");
    const state = await loadState(client, scope.company_id);

    // Rename harus lebih dulu: fase 1 mencocokkan bahan berdasarkan nama, jadi
    // ejaan yang salah di database harus dibetulkan sebelum satuannya disentuh.
    if (phases.has(2)) await phase2Renames(client, state, parsed, journal);
    if (phases.has(1)) await phase1(client, state, parsed, journal);
    if (phases.has(2)) {
      await phase2Masters(client, state, parsed, scope, journal);
      await phase2Products(client, state, parsed, scope, journal);
    }
    if (phases.has(3)) await phase3(client, state, parsed, journal);
    if (phases.has(4)) await phase4(client, state, parsed, scope, journal);

    verification = await verifyAgainstWorkbook(client, scope.company_id, parsed);
    posAfter = (await client.query(POS_SUMMARY_SQL)).rows[0];

    if (apply) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  report(journal, { apply });
  if (verification) {
    console.log("\nSisa selisih terhadap workbook (dihitung ulang setelah perubahan, sebelum commit):");
    let total = 0;
    for (const [label, findings] of verification) {
      total += findings.length;
      console.log(`   ${String(findings.length).padStart(5)}  ${label}`);
    }
    console.log(`   ${String(total).padStart(5)}  TOTAL`);
  }
  if (posBefore && posAfter) {
    const pct = (h, o) => (num(o) > 0 ? `${((num(h) / num(o)) * 100).toFixed(1)}%` : "-");
    console.log("\nDampak ke laporan profit POS:");
    console.log(`   ${"".padEnd(24)}${"sebelum".padStart(18)}${"sesudah".padStart(18)}`);
    console.log(`   ${"Omzet".padEnd(24)}${money(posBefore.omzet).padStart(18)}${money(posAfter.omzet).padStart(18)}`);
    console.log(`   ${"HPP".padEnd(24)}${money(posBefore.hpp).padStart(18)}${money(posAfter.hpp).padStart(18)}`);
    console.log(`   ${"HPP / omzet".padEnd(24)}${pct(posBefore.hpp, posBefore.omzet).padStart(18)}${pct(posAfter.hpp, posAfter.omzet).padStart(18)}`);
    console.log(`   ${"Baris HPP > harga jual".padEnd(24)}${String(posBefore.hpp_di_atas_harga).padStart(18)}${String(posAfter.hpp_di_atas_harga).padStart(18)}`);
    console.log(`   ${"Baris tanpa HPP".padEnd(24)}${String(posBefore.hpp_kosong).padStart(18)}${String(posAfter.hpp_kosong).padStart(18)}`);
  }
  const outDir = path.isAbsolute(opts.out || "")
    ? opts.out
    : path.join(BACKEND_ROOT, "..", opts.out || "docs/audit/menu-matrix-remediasi");
  writeJournal(journal, outDir, verification);
  console.log(`\nRincian: ${path.relative(BACKEND_ROOT, outDir)}/perubahan.csv · dilewati.csv`);
}

main().catch((error) => {
  console.error(`\nGAGAL: ${error.message}`);
  process.exitCode = 1;
});
