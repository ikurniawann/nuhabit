#!/usr/bin/env node
/**
 * Reset purchasing.suppliers (scope SULU / SULU-DAGO) dari kolom Vendor
 * di sheet Market List (SIW Menu Matrix).
 *
 * Data dummy lama (CV Segar Nusantara, dst.) diganti vendor unik Market List.
 * Nama gabungan "A / B" dipecah jadi dua master. Nilai "WIP" dilewati.
 *
 * Usage:
 *   npm run db:seed:purchasing-sulu-suppliers -- --dry-run
 *   npm run db:seed:purchasing-sulu-suppliers
 *   npm run db:seed:purchasing-sulu-suppliers -- --xlsx="docs/SIW - Menu Matrix Update.xlsx"
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { Client } = require("pg");
const {
  sslForUrl,
  assertLocalTarget,
  isLocalDatabaseUrl,
  parseHost,
} = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const HOLDING_CODE = "PROLOGE";
const COMPANY_CODE = "SULU";
const BRANCH_CODE = "SULU-DAGO";
const DEFAULT_KOTA = "Bandung";
const DEFAULT_PAYMENT_TERMS = "TOP30";
const SKIP_VENDOR_KEYS = new Set(["wip", "n/a", "na", "-", "tbd", "todo"]);

function defaultXlsxPath() {
  const updatePath = path.join(ROOT, "..", "docs", "SIW - Menu Matrix Update.xlsx");
  if (fs.existsSync(updatePath)) return updatePath;
  return path.join(ROOT, "..", "docs", "SIW - Menu Matrix.xlsx");
}

function loadEnv() {
  const shellKeys = new Set(Object.keys(process.env));
  for (const name of [".env", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

function databaseNameFromUrl(url) {
  try {
    return (
      (new URL(url.replace(/^postgresql:/i, "http:")).pathname || "").replace(
        /^\//,
        ""
      ) || "(unknown)"
    );
  } catch {
    return "(unknown)";
  }
}

function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function vendorKey(name) {
  return normalizeText(name).toLowerCase();
}

function kategoriFromCategory(category) {
  const key = vendorKey(category);
  if (key.startsWith("wip")) return "WIP";
  if (key.includes("packag") || key.includes("kemasan")) return "KEMASAN";
  return "BAHAN_BAKU";
}

function splitVendorNames(raw) {
  return normalizeText(raw)
    .split(/\s*\/\s*/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function readMarketVendors(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel tidak ditemukan: ${xlsxPath}`);
  }

  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = workbook.SheetNames.find(
    (name) => normalizeText(name).toLowerCase() === "market list"
  );
  if (!sheetName) {
    throw new Error("Sheet Market List tidak ditemukan");
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  let headerRowIndex = rows.findIndex((row) =>
    (row || []).some((cell) => vendorKey(cell) === "vendor")
  );
  if (headerRowIndex < 0) {
    throw new Error("Kolom Vendor tidak ditemukan di sheet Market List");
  }

  const header = (rows[headerRowIndex] || []).map((cell) => normalizeText(cell));
  const vendorIdx = header.findIndex((h) => h.toLowerCase() === "vendor");
  const catIdx = header.findIndex((h) => h.toLowerCase() === "category");
  const ingredientIdx = header.findIndex((h) =>
    ["ingredients", "ingredient", "bahan"].includes(h.toLowerCase())
  );

  const byKey = new Map();
  let skippedEmpty = 0;
  let skippedNamed = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const ingredient = normalizeText(row[ingredientIdx >= 0 ? ingredientIdx : 1]);
    const category = normalizeText(row[catIdx >= 0 ? catIdx : 0]);
    const vendorRaw = normalizeText(row[vendorIdx]);
    if (!ingredient && !vendorRaw) continue;
    if (!vendorRaw) {
      skippedEmpty += 1;
      continue;
    }

    for (const name of splitVendorNames(vendorRaw)) {
      const key = vendorKey(name);
      if (!key || SKIP_VENDOR_KEYS.has(key)) {
        skippedNamed += 1;
        continue;
      }
      if (!byKey.has(key)) {
        byKey.set(key, {
          nama_supplier: name,
          kategori: kategoriFromCategory(category),
          count: 0,
          samples: [],
        });
      }
      const rec = byKey.get(key);
      rec.count += 1;
      if (ingredient && rec.samples.length < 4) rec.samples.push(ingredient);
      if (rec.kategori === "BAHAN_BAKU" && kategoriFromCategory(category) !== "WIP") {
        rec.kategori = kategoriFromCategory(category);
      }
    }
  }

  const vendors = [...byKey.values()].sort((a, b) =>
    a.nama_supplier.localeCompare(b.nama_supplier, "id")
  );

  return { vendors, skippedEmpty, skippedNamed, sheetName };
}

async function resolveScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id, c.id AS company_id, b.id AS branch_id,
            h.name AS holding_name, c.name AS company_name, b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c ON c.holding_id = h.id AND c.code = $2
     JOIN configuration.branches b ON b.company_id = c.id AND b.code = $3
     WHERE h.code = $1`,
    [HOLDING_CODE, COMPANY_CODE, BRANCH_CODE]
  );
  if (!rows[0]) {
    throw new Error(
      `Scope ${HOLDING_CODE}/${COMPANY_CODE}/${BRANCH_CODE} tidak ditemukan`
    );
  }
  return rows[0];
}

async function wipeSuppliers(client, companyId, branchId) {
  await client.query(
    `
    WITH scoped AS (
      SELECT id FROM purchasing.suppliers
      WHERE company_id = $1 AND branch_id = $2
    )
    DELETE FROM purchasing.supplier_price_lists
    WHERE supplier_id IN (SELECT id FROM scoped)
    `,
    [companyId, branchId]
  );
  await client.query(
    `
    WITH scoped AS (
      SELECT id FROM purchasing.suppliers
      WHERE company_id = $1 AND branch_id = $2
    )
    DELETE FROM purchasing.purchase_order_payment_terms
    WHERE supplier_id IN (SELECT id FROM scoped)
    `,
    [companyId, branchId]
  );
  await client.query(
    `
    UPDATE purchasing.vendor_credits
       SET supplier_id = NULL
     WHERE supplier_id IN (
       SELECT id FROM purchasing.suppliers WHERE company_id = $1 AND branch_id = $2
     )
    `,
    [companyId, branchId]
  );
  await client.query(
    `
    UPDATE purchasing.vendor_documents
       SET supplier_id = NULL
     WHERE supplier_id IN (
       SELECT id FROM purchasing.suppliers WHERE company_id = $1 AND branch_id = $2
     )
    `,
    [companyId, branchId]
  );
  await client.query(
    `DELETE FROM purchasing.suppliers WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
}

async function insertSuppliers(client, scope, vendors) {
  const inserted = [];
  for (let i = 0; i < vendors.length; i++) {
    const vendor = vendors[i];
    const kode = `SUP-SULU-${String(i + 1).padStart(3, "0")}`;
    const catatanParts = [
      "Diimpor dari Market List SIW.",
      `${vendor.count} baris bahan.`,
    ];
    if (vendor.samples.length) {
      catatanParts.push(`Contoh: ${vendor.samples.join(", ")}`);
    }
    const { rows } = await client.query(
      `INSERT INTO purchasing.suppliers (
         kode, nama_supplier, kota, payment_terms, currency, kategori,
         catatan, status, is_active, company_id, branch_id
       ) VALUES (
         $1, $2, $3, $4, 'IDR', $5, $6, 'active', true, $7, $8
       )
       RETURNING kode, nama_supplier`,
      [
        kode,
        vendor.nama_supplier,
        DEFAULT_KOTA,
        DEFAULT_PAYMENT_TERMS,
        vendor.kategori,
        catatanParts.join(" "),
        scope.company_id,
        scope.branch_id,
      ]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const allowRemote =
    process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_DB === "1";
  const confirmRemote =
    process.argv.includes("--confirm-remote") ||
    process.argv.includes("--confirm-remote-wipe") ||
    process.env.CONFIRM_REMOTE_SUPPLIER_RESET === "YES";
  const xlsxArg = process.argv.find((a) => a.startsWith("--xlsx="));
  const xlsxPath = xlsxArg ? xlsxArg.slice("--xlsx=".length) : defaultXlsxPath();

  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }

  const host = parseHost(url);
  const dbName = databaseNameFromUrl(url);
  const isRemote = !isLocalDatabaseUrl(url);

  if (isRemote) {
    if (!allowRemote) {
      console.error(`REFUSED: remote ${host}/${dbName}. Tambahkan --allow-remote.`);
      process.exit(1);
    }
    if (!dryRun && !confirmRemote) {
      console.error(
        `REFUSED: apply remote butuh --confirm-remote (host=${host} db=${dbName}).`
      );
      process.exit(1);
    }
    console.warn(
      `WARNING: REMOTE target ${host}/${dbName} mode=${dryRun ? "dry-run" : "APPLY"}`
    );
  } else {
    try {
      assertLocalTarget(url, "MIGRATE_DATABASE_URL");
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const { vendors, skippedEmpty, skippedNamed, sheetName } =
    readMarketVendors(xlsxPath);

  console.log(`Target: ${host}/${dbName}${isRemote ? " (remote)" : " (local)"}`);
  console.log(`Excel: ${xlsxPath}`);
  console.log(`Sheet: ${sheetName}`);
  console.log(`Vendor unik: ${vendors.length}`);
  console.log(`Baris tanpa vendor: ${skippedEmpty}`);
  console.log(`Nama dilewati (WIP/placeholder): ${skippedNamed}`);
  for (const v of vendors) {
    console.log(`  ${v.nama_supplier} (${v.count}) [${v.kategori}]`);
  }

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();

  try {
    if (!dryRun) await client.query("BEGIN");

    const scope = await resolveScope(client);
    console.log(
      `Scope: ${scope.holding_name} → ${scope.company_name} → ${scope.branch_name}`
    );

    const existing = await client.query(
      `SELECT kode, nama_supplier
         FROM purchasing.suppliers
        WHERE company_id = $1 AND branch_id = $2 AND deleted_at IS NULL
        ORDER BY kode`,
      [scope.company_id, scope.branch_id]
    );
    console.log(`Supplier lama: ${existing.rowCount}`);
    existing.rows.slice(0, 12).forEach((row) => {
      console.log(`  - ${row.kode} ${row.nama_supplier}`);
    });

    if (dryRun) {
      console.log("\nDry-run selesai (tidak ada write).");
      return;
    }

    await wipeSuppliers(client, scope.company_id, scope.branch_id);
    const inserted = await insertSuppliers(client, scope, vendors);
    await client.query("COMMIT");

    console.log(`\nSelesai. Supplier baru: ${inserted.length}`);
    inserted.forEach((row) => console.log(`  + ${row.kode} ${row.nama_supplier}`));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
