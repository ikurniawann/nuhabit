#!/usr/bin/env node
/**
 * Backfill item.raw_materials COA (+ kategori) dari sheet Market List
 * pada SIW Menu Matrix terbaru.
 *
 * Matching: nama bahan ≈ Ingredients (Market List) → Category → COA.
 * Fallback: kode/nama mengandung WIP → ST KOH WIP; alias khusus; else kategori sistem.
 *
 * Usage:
 *   npm run db:seed:items-raw-materials-coa -- --dry-run
 *   npm run db:seed:items-raw-materials-coa
 *   npm run db:seed:items-raw-materials-coa -- --xlsx="docs/SIW - Menu Matrix Updated 20-08-2026.xlsx"
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
const { resolveSeedBusinessScope } = require("../scripts/items-business-scope");
const {
  normalizeName,
  resolveDefaultCoaForCategory,
  deriveLegacyCoaEnum,
  systemKategoriFromMarketCategory,
  COA_INV,
  COA_COGS,
} = require("./lib/raw-material-coa-map");

const ROOT = path.join(__dirname, "..", "..");

/** Alias nama DB → Ingredients Market List (kasus mismatch 1:1). */
const NAME_ALIASES = {
  "tapioka charcoal": "tepung tapioka",
};

function defaultXlsxPath() {
  const candidates = [
    path.join(ROOT, "..", "docs", "SIW - Menu Matrix Updated 20-08-2026.xlsx"),
    path.join(ROOT, "..", "docs", "SIW - Menu Matrix Update.xlsx"),
    path.join(ROOT, "..", "docs", "SIW - Menu Matrix.xlsx"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
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

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
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

function readMarketList(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel tidak ditemukan: ${xlsxPath}`);
  }
  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = workbook.SheetNames.find(
    (n) => String(n).trim().toLowerCase() === "market list"
  );
  if (!sheetName) throw new Error("Sheet Market List tidak ditemukan");

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  const headerIdx = rows.findIndex((row) =>
    (row || []).some((cell) => String(cell).trim().toLowerCase() === "category")
  );
  if (headerIdx < 0) throw new Error("Header Category tidak ditemukan");

  /** @type {Map<string, { category: string, ingredient: string }>} */
  const byName = new Map();
  const categoryCounts = new Map();

  for (const row of rows.slice(headerIdx + 1)) {
    const category = String(row[0] || "").trim();
    const ingredient = String(row[1] || "").trim();
    if (!category || !ingredient) continue;

    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

    const keys = new Set([normalizeName(ingredient)]);
    if (ingredient.includes("/")) {
      for (const part of ingredient.split("/")) {
        const k = normalizeName(part);
        if (k) keys.add(k);
      }
    }
    for (const key of keys) {
      if (!key) continue;
      if (!byName.has(key)) {
        byName.set(key, { category, ingredient });
      }
    }
  }

  return { byName, categoryCounts, sheetName };
}

function resolveMarketCategory(rm, byName) {
  const namaNorm = normalizeName(rm.nama);
  const aliasTarget = NAME_ALIASES[namaNorm];
  const lookupKeys = [namaNorm];
  if (aliasTarget) lookupKeys.push(normalizeName(aliasTarget));

  for (const key of lookupKeys) {
    const hit = byName.get(key);
    if (hit) return { category: hit.category, source: "market_list", match: hit.ingredient };
  }

  if (/wip/i.test(rm.nama) || /WIP/i.test(String(rm.kode || ""))) {
    return { category: "ST KOH WIP", source: "wip_heuristic", match: null };
  }

  if (rm.kategori && rm.kategori !== "LAIN") {
    return { category: rm.kategori, source: "system_kategori", match: null };
  }

  return { category: "ST Other", source: "fallback_other", match: null };
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const allowRemote =
    process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_DB === "1";
  const confirmRemote =
    process.argv.includes("--confirm-remote") ||
    process.env.CONFIRM_REMOTE_RAW_MATERIAL_COA === "YES";
  const xlsxPath = path.resolve(
    ROOT,
    argValue("--xlsx=") || defaultXlsxPath()
  );
  const updateKategori = !process.argv.includes("--skip-kategori");

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
      console.error(
        `REFUSED: remote ${host}/${dbName}. Tambahkan --allow-remote.`
      );
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

  console.log(
    `Target DB: ${dbName} @ ${host || "?"}` +
      (isRemote ? " (remote)" : " (local)")
  );
  console.log(`Excel: ${path.relative(ROOT, xlsxPath)}`);
  console.log(
    `Mode: ${dryRun ? "DRY-RUN" : "APPLY"} | update kategori: ${updateKategori}`
  );

  const { byName, categoryCounts, sheetName } = readMarketList(xlsxPath);
  console.log(`Sheet "${sheetName}": ${byName.size} nama Ingredients, kategori:`);
  for (const [cat, n] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const coa = resolveDefaultCoaForCategory(cat);
    console.log(
      `  ${String(n).padStart(3)}  ${cat} → asset ${coa.coa_asset} / prod ${coa.coa_production}`
    );
  }

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();

  try {
    // Pastikan kolom COA sudah ada (migrasi 20260821170000)
    const colCheck = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'item'
         AND table_name = 'raw_materials'
         AND column_name = 'coa_asset'
       LIMIT 1`
    );
    if (colCheck.rowCount === 0) {
      throw new Error(
        "Kolom item.raw_materials.coa_asset belum ada. Jalankan migrasi dulu:\n" +
          "  MIGRATE_DATABASE_URL=<url-remote> npm run db:migrate:apply -- --allow-remote"
      );
    }

    const scope = await resolveSeedBusinessScope(client);
    console.log(`Scope: ${scope.company_name} / ${scope.branch_name}`);

    const { rows: materials } = await client.query(
      `SELECT id, kode, nama, kategori, material_type,
              coa, coa_production, coa_rnd, coa_asset
       FROM item.raw_materials
       WHERE deleted_at IS NULL
         AND (
           company_id = $1
           OR company_id IS NULL
         )
       ORDER BY nama`,
      [scope.company_id]
    );

    const stats = {
      total: materials.length,
      updated: 0,
      unchanged: 0,
      bySource: {},
      byAsset: {},
    };

    if (!dryRun) await client.query("BEGIN");

    for (const rm of materials) {
      const resolved = resolveMarketCategory(rm, byName);
      stats.bySource[resolved.source] =
        (stats.bySource[resolved.source] || 0) + 1;

      const coa = resolveDefaultCoaForCategory(resolved.category);
      let coa_asset = coa.coa_asset;
      let coa_production = coa.coa_production;

      if (
        String(rm.material_type || "").toUpperCase() === "WIP" &&
        (!coa_asset || coa_asset === COA_INV.OTHER)
      ) {
        coa_asset = COA_INV.KOH_WIP;
        coa_production = COA_COGS.FOOD_RAW;
      }

      const legacy = deriveLegacyCoaEnum({
        coa_production,
        coa_asset,
      });

      const nextKategori = updateKategori
        ? systemKategoriFromMarketCategory(resolved.category) || rm.kategori
        : rm.kategori;

      const changed =
        rm.coa_asset !== coa_asset ||
        rm.coa_production !== coa_production ||
        rm.coa !== legacy ||
        (updateKategori && rm.kategori !== nextKategori);

      if (!changed) {
        stats.unchanged += 1;
        continue;
      }

      stats.updated += 1;
      stats.byAsset[coa_asset || "(null)"] =
        (stats.byAsset[coa_asset || "(null)"] || 0) + 1;

      if (dryRun) {
        if (stats.updated <= 12) {
          console.log(
            `  ~ ${rm.kode} ${rm.nama} | ${rm.kategori}→${nextKategori} | ` +
              `asset ${coa_asset} prod ${coa_production} (${resolved.source}: ${resolved.category})`
          );
        }
        continue;
      }

      await client.query(
        `UPDATE item.raw_materials
         SET coa_asset = $2,
             coa_production = $3,
             coa = $4,
             kategori = $5,
             updated_at = NOW()
         WHERE id = $1`,
        [rm.id, coa_asset, coa_production, legacy, nextKategori]
      );
    }

    if (!dryRun) await client.query("COMMIT");

    console.log("\nRingkasan:");
    console.log(`  total     : ${stats.total}`);
    console.log(`  updated   : ${stats.updated}`);
    console.log(`  unchanged : ${stats.unchanged}`);
    console.log("  by source :", stats.bySource);
    console.log("  by asset  :", stats.byAsset);
    if (dryRun) {
      console.log("\nDry-run selesai. Jalankan tanpa --dry-run untuk menerapkan.");
    } else {
      console.log("\nBackfill COA selesai.");
    }
  } catch (err) {
    if (!dryRun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
