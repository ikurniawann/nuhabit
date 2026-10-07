#!/usr/bin/env node
/**
 * Audit read-only: bandingkan workbook "SIW - Menu Matrix" dengan database.
 *
 *   npm run audit:menu-matrix -- --allow-remote
 *
 * Script ini TIDAK PERNAH menulis ke database. Sesi Postgres di-set
 * `default_transaction_read_only = on` sebagai pengaman tambahan.
 *
 * Flag:
 *   --xlsx=<path>     workbook (default: docs/SIW - Menu Matrix*.xlsx terbaru)
 *   --db=<url>        connection string (default: AUDIT_DATABASE_URL → DATABASE_URL)
 *   --out=<dir>       folder output (default: docs/audit/menu-matrix-vs-db)
 *   --allow-remote    wajib bila host bukan localhost
 *   --parse-only      hanya parse workbook, tidak menyentuh database
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

import { parseMenuMatrix } from "./lib/parse-menu-matrix.mjs";
import {
  SEVERITY,
  nkey,
  compareRawMaterials,
  compareWip,
  compareProducts,
  checkWorkbookReferences,
} from "./lib/compare.mjs";

const require = createRequire(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { parseHost, isLocalDatabaseUrl, sslForUrl } = require(
  path.join(BACKEND_ROOT, "database/scripts/pg-utils.js")
);
const { systemKategoriFromMarketCategory } = require(
  path.join(BACKEND_ROOT, "database/seeders/lib/raw-material-coa-map.js")
);

// ------------------------------------------------------------------ env & args

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    const full = path.join(BACKEND_ROOT, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["'](.*)["']$/, "$1");
    }
  }
}

function parseArgs(argv) {
  const args = { flags: new Set(), opts: {} };
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    if (match[2] === undefined) args.flags.add(match[1]);
    else args.opts[match[1]] = match[2];
  }
  return args;
}

function resolveXlsx(explicit) {
  if (explicit) {
    const full = path.isAbsolute(explicit) ? explicit : path.join(BACKEND_ROOT, "..", explicit);
    if (!fs.existsSync(full)) throw new Error(`Workbook tidak ditemukan: ${full}`);
    return full;
  }
  const docs = path.join(BACKEND_ROOT, "..", "docs");
  const candidates = fs
    .readdirSync(docs)
    .filter((name) => /^SIW - Menu Matrix.*\.xlsx$/i.test(name) && !name.startsWith("~$"))
    .map((name) => ({ name, full: path.join(docs, name), mtime: fs.statSync(path.join(docs, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error('Tidak ada file "docs/SIW - Menu Matrix*.xlsx".');
  return candidates[0].full;
}

// -------------------------------------------------------------------- database

const SQL_RAW_MATERIALS = `
  SELECT rm.id, rm.kode, rm.nama, rm.kategori, rm.material_type,
         rm.konversi_factor, rm.harga_beli,
         ub.kode AS satuan_besar, uk.kode AS satuan_kecil
    FROM item.raw_materials rm
    LEFT JOIN item.units ub ON ub.id = rm.satuan_besar_id
    LEFT JOIN item.units uk ON uk.id = rm.satuan_kecil_id
   WHERE rm.deleted_at IS NULL
     AND (rm.company_id = $1 OR rm.company_id IS NULL)`;

const SQL_PRODUCTS = `
  SELECT p.id, p.kode, p.nama, p.kategori, p.harga_jual, p.harga_modal, p.station,
         u.kode AS satuan
    FROM item.products p
    LEFT JOIN item.units u ON u.id = p.satuan_id
   WHERE p.deleted_at IS NULL
     AND (p.company_id = $1 OR p.company_id IS NULL)`;

const SQL_PRODUCT_BOM = `
  SELECT b.id, b.product_id, b.raw_material_id, b.qty_required, b.waste_factor,
         rm.nama AS raw_material_nama, rm.kode AS raw_material_kode,
         u.kode AS satuan
    FROM manufacturing.bom_items b
    JOIN item.products p ON p.id = b.product_id AND p.deleted_at IS NULL
    JOIN item.raw_materials rm ON rm.id = b.raw_material_id
    LEFT JOIN item.units u ON u.id = b.satuan_id
   WHERE b.is_active = true`;

const SQL_RM_BOM = `
  SELECT b.id, b.output_raw_material_id, b.component_raw_material_id, b.qty_required,
         rm.nama AS component_nama, rm.kode AS component_kode,
         u.kode AS satuan
    FROM manufacturing.raw_material_bom_items b
    JOIN item.raw_materials rm ON rm.id = b.component_raw_material_id
    LEFT JOIN item.units u ON u.id = b.satuan_id
   WHERE b.is_active = true`;

async function fetchDatabase(client, companyId) {
  // Satu pg.Client hanya boleh menjalankan satu query pada satu waktu.
  const rawMaterials = await client.query(SQL_RAW_MATERIALS, [companyId]);
  const products = await client.query(SQL_PRODUCTS, [companyId]);
  const productBom = await client.query(SQL_PRODUCT_BOM);
  const rmBom = await client.query(SQL_RM_BOM);

  const groupBy = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row[key])) map.set(row[key], []);
      map.get(row[key]).push(row);
    }
    return map;
  };

  return {
    rawMaterials: rawMaterials.rows,
    products: products.rows,
    bom: groupBy(productBom.rows, "product_id"),
    rawMaterialBom: groupBy(rmBom.rows, "output_raw_material_id"),
  };
}

// ---------------------------------------------------------------------- output

const CSV_HEADER = [
  "severity",
  "dimension",
  "entity",
  "key",
  "field",
  "excel_value",
  "db_value",
  "delta",
  "near_match",
  "note",
];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, findings) {
  const lines = [CSV_HEADER.join(",")];
  for (const f of findings) {
    lines.push(
      [
        f.severity,
        f.dimension,
        f.entity,
        f.key,
        f.field,
        f.excelValue,
        f.dbValue,
        f.delta,
        f.nearMatch,
        f.note,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // BOM UTF-8 supaya Excel membaca karakter non-ASCII dengan benar.
  fs.writeFileSync(file, `﻿${lines.join("\n")}\n`, "utf8");
}

function tally(findings) {
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return counts;
}

function fmtCounts(counts) {
  const order = [
    SEVERITY.MISSING_IN_DB,
    SEVERITY.EXTRA_IN_DB,
    SEVERITY.VALUE_MISMATCH,
    SEVERITY.RENAME_CANDIDATE,
    SEVERITY.DATA_QUALITY,
  ];
  return order.map((s) => counts[s] || 0);
}

function mdTable(headers, rows) {
  const out = [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`];
  for (const row of rows) out.push(`| ${row.join(" | ")} |`);
  return out.join("\n");
}

function esc(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function num(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("id-ID", { maximumFractionDigits: digits }) : "";
}


/**
 * Tingkat kecocokan per objek workbook: sebuah objek dihitung "cocok" bila
 * tidak muncul sama sekali di daftar temuan (baik sebagai master maupun BOM-nya).
 */
function matchRates({ parsed, sections }) {
  const bySection = Object.fromEntries(sections.map((s) => [s.csv, s.findings]));
  const head = (key) => String(key).split(" \u2192 ")[0];
  const keysOf = (csv) => (bySection[csv] || []).map((f) => nkey(head(f.key)));

  const build = (label, names, csvs, absentCsv) => {
    const universe = new Set(names.map(nkey));
    const touched = new Set(csvs.flatMap(keysOf).filter((k) => universe.has(k)));
    const absent = new Set(
      (bySection[absentCsv] || [])
        .filter(
          (f) =>
            f.field === "existence" &&
            (f.severity === SEVERITY.MISSING_IN_DB || f.severity === SEVERITY.RENAME_CANDIDATE)
        )
        .map((f) => nkey(f.key))
        .filter((k) => universe.has(k))
    );
    return {
      label,
      total: universe.size,
      absent: absent.size,
      differ: touched.size - absent.size,
      match: universe.size - touched.size,
    };
  };

  return [
    build(
      "Bahan baku beli",
      parsed.marketList.filter((i) => !i.isWip).map((i) => i.name),
      ["01-raw-materials.csv"],
      "01-raw-materials.csv"
    ),
    build(
      "WIP",
      parsed.wipBlocks.map((b) => b.name),
      ["02-wip-master.csv", "03-wip-bom.csv"],
      "02-wip-master.csv"
    ),
    build(
      "Menu / produk",
      parsed.menus.map((m) => m.name),
      ["04-products.csv", "05-product-bom.csv"],
      "04-products.csv"
    ),
  ];
}

function buildSummary({ parsed, db, sections, meta }) {
  const lines = [];
  lines.push("# Audit: SIW Menu Matrix vs Database");
  lines.push("");
  lines.push(`- **Workbook**: \`${path.relative(BACKEND_ROOT, parsed.file)}\``);
  lines.push(`- **Database**: \`${meta.host}\` / \`${meta.database}\``);
  lines.push(`- **Scope**: company \`${meta.companyCode}\` · branch \`${meta.branchCode}\``);
  lines.push(`- **Dijalankan**: ${meta.startedAt}`);
  lines.push("");
  lines.push("## 1. Cakupan data");
  lines.push("");
  lines.push(
    mdTable(
      ["Objek", "Workbook", "Database"],
      [
        [
          "Bahan baku beli",
          parsed.marketList.filter((i) => !i.isWip).length,
          db.rawMaterials.filter((r) => r.material_type === "PURCHASED").length,
        ],
        [
          "WIP",
          parsed.wipBlocks.length,
          db.rawMaterials.filter((r) => r.material_type === "WIP").length,
        ],
        ["Menu / produk", parsed.menus.length, db.products.length],
        [
          "Baris BOM produk",
          parsed.menus.reduce((a, m) => a + m.elements.length, 0),
          [...db.bom.values()].reduce((a, v) => a + v.length, 0),
        ],
        [
          "Baris resep WIP",
          parsed.wipBlocks.reduce((a, b) => a + b.components.length, 0),
          [...db.rawMaterialBom.values()].reduce((a, v) => a + v.length, 0),
        ],
        ["Produk punya BOM", "-", `${db.bom.size} / ${db.products.length}`],
        [
          "WIP punya resep",
          "-",
          `${db.rawMaterialBom.size} / ${db.rawMaterials.filter((r) => r.material_type === "WIP").length}`,
        ],
      ].map((row) => row.map(esc))
    )
  );
  lines.push("");
  lines.push("## 2. Tingkat kecocokan");
  lines.push("");
  lines.push(
    "Dihitung per objek, bukan per baris temuan: satu objek dianggap **cocok** hanya bila " +
      "tidak ada satu pun selisih pada master maupun BOM-nya."
  );
  lines.push("");
  const rates = matchRates({ parsed, sections });
  lines.push(
    mdTable(
      ["Objek di workbook", "Total", "Tidak ada di DB", "Ada tapi beda", "Cocok", "% cocok"],
      rates.map((r) => [
        esc(r.label),
        r.total,
        r.absent,
        r.differ,
        r.match,
        `${((r.match / r.total) * 100).toFixed(0)}%`,
      ])
    )
  );
  const rateTotal = rates.reduce((a, r) => a + r.total, 0);
  const rateMatch = rates.reduce((a, r) => a + r.match, 0);
  lines.push("");
  lines.push(
    `**${rateMatch} dari ${rateTotal} objek (${((rateMatch / rateTotal) * 100).toFixed(0)}%) cocok sepenuhnya.**`
  );
  lines.push("");
  lines.push("## 3. Ringkasan temuan");
  lines.push("");
  lines.push(
    mdTable(
      ["Dimensi", "File", "Hilang di DB", "Ekstra di DB", "Nilai beda", "Kandidat rename", "Kualitas data", "Total"],
      sections.map((s) => {
        const c = fmtCounts(tally(s.findings));
        return [esc(s.title), `\`${s.csv}\``, ...c, s.findings.length];
      })
    )
  );
  lines.push("");
  const total = sections.reduce((a, s) => a + s.findings.length, 0);
  lines.push(`**Total temuan: ${total}.**`);
  lines.push("");

  // Pola masalah yang berulang — ini yang menjelaskan mayoritas selisih rupiah.
  const all = sections.flatMap((s) => s.findings);
  const patterns = [
    {
      label: "`konversi_factor` = 1 padahal Market List punya isi kemasan > 1",
      rows: all.filter(
        (f) => f.field === "konversi_factor" && Number(f.dbValue) === 1 && Number(f.excelValue) > 1
      ),
      impact:
        "Biaya per gram/ml jadi sebesar harga satu kemasan penuh — sumber utama COGS yang membengkak.",
    },
    {
      label: "`satuan_besar` tidak mencerminkan Purchase UOM",
      rows: all.filter((f) => f.field === "satuan_besar"),
      impact: "Satuan pembelian di master tidak sama dengan yang dipakai purchasing di Market List.",
    },
    {
      label: "Satuan baris BOM ditulis `GR` padahal workbook memakai satuan lain",
      rows: all.filter((f) => f.field === "satuan" && f.dbValue === "GR"),
      impact: "ML / BUTIR / PCS tercatat sebagai gram, sehingga konversi stok dan biaya salah.",
    },
    {
      label: "`harga_modal` produk masih 0",
      rows: all.filter((f) => f.field === "harga_modal" && Number(f.dbValue) === 0),
      impact: "Produk tidak punya COGS sama sekali di database.",
    },
    {
      label: "Komponen sudah ada di master tapi belum terpasang di BOM",
      rows: all.filter(
        (f) => f.severity === SEVERITY.MISSING_IN_DB && /ada di master/.test(f.note)
      ),
      impact: "Resep tinggal dihubungkan, bahannya sendiri tidak perlu dibuat ulang.",
    },
    {
      label: "Komponen belum ada sama sekali di `item.raw_materials`",
      rows: all.filter((f) => f.severity === SEVERITY.MISSING_IN_DB && /tidak ada di item/.test(f.note)),
      impact: "Master bahan harus dibuat dulu sebelum resepnya bisa dipasang.",
    },
  ].filter((p) => p.rows.length);

  if (patterns.length) {
    lines.push("## 4. Pola masalah utama");
    lines.push("");
    lines.push(
      mdTable(
        ["Pola", "Jumlah", "Dampak"],
        patterns.map((p) => [esc(p.label), p.rows.length, esc(p.impact)])
      )
    );
    lines.push("");
    const konv = patterns.find((p) => p.label.startsWith("`konversi_factor`"));
    if (konv) {
      lines.push(
        `> Contoh: **${esc(konv.rows[0].key)}** — Market List mencatat kemasan ` +
          `${num(konv.rows[0].excelValue)} unit, database mencatat \`konversi_factor = 1\`. ` +
          "Akibatnya harga satu kemasan dibaca sebagai harga per satuan terkecil."
      );
      lines.push("");
    }
  }

  // Selisih rupiah terbesar.
  const money = sections
    .flatMap((s) => s.findings)
    .filter(
      (f) =>
        f.severity === SEVERITY.VALUE_MISMATCH &&
        Number.isFinite(Number(f.delta)) &&
        /harga|biaya|cost/i.test(f.field)
    )
    .sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)))
    .slice(0, 15);
  if (money.length) {
    lines.push("## 5. Selisih nilai terbesar");
    lines.push("");
    lines.push(
      "Nilai `Direct Cost (rekalkulasi BOM)` dihitung ulang dari BOM database, jadi ikut membesar " +
        "karena pola `konversi_factor` di atas — bukan selisih yang berdiri sendiri."
    );
    lines.push("");
    lines.push(
      mdTable(
        ["Item", "Field", "Workbook", "Database", "Selisih"],
        money.map((f) => [esc(f.key), esc(f.field), num(f.excelValue), num(f.dbValue), num(f.delta)])
      )
    );
    lines.push("");
  }

  // Kandidat rename.
  const renames = sections
    .flatMap((s) => s.findings)
    .filter((f) => f.severity === SEVERITY.RENAME_CANDIDATE && f.excelValue !== "");
  if (renames.length) {
    lines.push("## 6. Kandidat salah tulis / rename");
    lines.push("");
    lines.push("Nama berbeda tapi sangat mirip — perlu diputuskan mana yang benar sebelum data ditambal.");
    lines.push("");
    lines.push(
      mdTable(
        ["Nama di workbook", "Nama di database", "Dimensi"],
        renames.map((f) => [esc(f.key), esc(f.nearMatch), esc(f.dimension)])
      )
    );
    lines.push("");
  }

  lines.push("## 7. Cara membaca");
  lines.push("");
  lines.push("| Severity | Arti |");
  lines.push("|---|---|");
  lines.push("| `MISSING_IN_DB` | Ada di workbook, tidak ada di database. |");
  lines.push("| `EXTRA_IN_DB` | Ada di database, tidak ada di workbook. |");
  lines.push("| `VALUE_MISMATCH` | Objek yang sama, nilainya berbeda (harga, qty, satuan, kategori). |");
  lines.push("| `RENAME_CANDIDATE` | Pasangan hilang/ekstra dengan nama sangat mirip — kemungkinan typo atau rename. |");
  lines.push("| `DATA_QUALITY` | Masalah internal workbook (referensi tidak ketemu, satuan tak dikenal, biaya tidak konsisten). |");
  lines.push("");
  lines.push(
    `Toleransi pembanding: uang ±0,01 · qty ±0,0001. Audit ini read-only; tidak ada data yang diubah.`
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ------------------------------------------------------------------------ main

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const xlsxPath = resolveXlsx(args.opts.xlsx);
  console.log(`Workbook : ${path.relative(BACKEND_ROOT, xlsxPath)}`);
  const parsed = parseMenuMatrix(xlsxPath);
  console.log(
    `Parsed   : ${parsed.marketList.length} Market List · ${parsed.wipBlocks.length} WIP · ` +
      `${parsed.menus.length} menu di ${parsed.stallSheets.length} sheet stall · ${parsed.summary.length} Summary`
  );

  if (args.flags.has("parse-only")) {
    console.log("--parse-only: berhenti sebelum menyentuh database.");
    return;
  }

  const dbUrl = args.opts.db || process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("AUDIT_DATABASE_URL / DATABASE_URL belum diset.");
  const host = parseHost(dbUrl);
  if (!isLocalDatabaseUrl(dbUrl) && !args.flags.has("allow-remote")) {
    throw new Error(`REFUSED: target "${host}" bukan localhost. Tambahkan --allow-remote (audit ini read-only).`);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: sslForUrl(dbUrl) });
  await client.connect();
  let db;
  let scope;
  try {
    await client.query("SET SESSION default_transaction_read_only = on");
    await client.query("SET SESSION statement_timeout = '120s'");
    const { rows } = await client.query("SELECT current_database() AS db");
    console.log(`Database : ${host} / ${rows[0].db} (sesi read-only)`);

    const companyCode = args.opts.company || process.env.SEED_COMPANY_CODE || "SULU";
    const branchCode = args.opts.branch || process.env.SEED_BRANCH_CODE || "SULU-DAGO";
    const scopeResult = await client.query(
      `SELECT c.id AS company_id, b.id AS branch_id, c.name AS company_name, b.name AS branch_name
         FROM configuration.companies c
         LEFT JOIN configuration.branches b ON b.company_id = c.id AND b.code = $2
        WHERE c.code = $1
        LIMIT 1`,
      [companyCode, branchCode]
    );
    if (!scopeResult.rows[0]) throw new Error(`Company "${companyCode}" tidak ditemukan.`);
    scope = { ...scopeResult.rows[0], companyCode, branchCode, database: rows[0].db };

    db = await fetchDatabase(client, scope.company_id);
  } finally {
    await client.end();
  }

  const rawFindings = compareRawMaterials({
    marketList: parsed.marketList,
    dbRawMaterials: db.rawMaterials,
    systemKategoriFromMarketCategory,
  });
  const wip = compareWip({
    marketList: parsed.marketList,
    wipBlocks: parsed.wipBlocks,
    dbRawMaterials: db.rawMaterials,
    dbRawMaterialBom: db.rawMaterialBom,
  });
  const products = compareProducts({
    menus: parsed.menus,
    summary: parsed.summary,
    dbProducts: db.products,
    dbBom: db.bom,
    dbRawMaterials: db.rawMaterials,
  });
  const references = checkWorkbookReferences(parsed);

  const sections = [
    { title: "A. Bahan Baku (Market List)", csv: "01-raw-materials.csv", findings: rawFindings },
    { title: "B. Master WIP", csv: "02-wip-master.csv", findings: wip.master },
    { title: "C. Resep WIP", csv: "03-wip-bom.csv", findings: wip.bom },
    { title: "D. Produk / Menu", csv: "04-products.csv", findings: products.product },
    { title: "E. BOM Produk", csv: "05-product-bom.csv", findings: products.bom },
    { title: "F. Integritas Workbook", csv: "06-unresolved-references.csv", findings: references },
  ];

  const outDir = path.isAbsolute(args.opts.out || "")
    ? args.opts.out
    : path.join(BACKEND_ROOT, "..", args.opts.out || "docs/audit/menu-matrix-vs-db");
  fs.mkdirSync(outDir, { recursive: true });

  for (const section of sections) writeCsv(path.join(outDir, section.csv), section.findings);
  fs.writeFileSync(
    path.join(outDir, "SUMMARY.md"),
    buildSummary({
      parsed,
      db,
      sections,
      meta: {
        host,
        database: scope.database,
        companyCode: scope.companyCode,
        branchCode: scope.branchCode,
        startedAt,
      },
    }),
    "utf8"
  );

  console.log("");
  for (const section of sections) {
    console.log(`${section.title.padEnd(30)} ${String(section.findings.length).padStart(5)} temuan → ${section.csv}`);
  }
  console.log(`\nLaporan: ${path.relative(BACKEND_ROOT, outDir)}/SUMMARY.md`);
}

main().catch((error) => {
  console.error(`\nGAGAL: ${error.message}`);
  process.exitCode = 1;
});
