#!/usr/bin/env node
/**
 * Non-aktifkan menu placeholder — menu yang di Summary Menu berstatus
 * "Recipe Pending" dan belum punya Selling Price.
 *
 *   node scripts/audit/deactivate-placeholders.mjs --allow-remote            # dry-run
 *   node scripts/audit/deactivate-placeholders.mjs --allow-remote --apply --confirm-remote
 *
 * Pengaman: produk yang PERNAH terjual tidak pernah dinonaktifkan — dilaporkan
 * supaya dialihkan manual ke menu aktif yang setara. Baris riwayat order tidak
 * disentuh sama sekali (product_name / product_sku / harga sudah tersimpan
 * sebagai snapshot di pos_order_items).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

import { parseMenuMatrix } from "./lib/parse-menu-matrix.mjs";
import { nkey } from "./lib/compare.mjs";

const require = createRequire(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { parseHost, isLocalDatabaseUrl, sslForUrl } = require(
  path.join(BACKEND_ROOT, "database/scripts/pg-utils.js")
);

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

function resolveXlsx() {
  const docs = path.join(BACKEND_ROOT, "..", "docs");
  const found = fs
    .readdirSync(docs)
    .filter((n) => /^SIW - Menu Matrix.*\.xlsx$/i.test(n) && !n.startsWith("~$"))
    .map((n) => ({ full: path.join(docs, n), mtime: fs.statSync(path.join(docs, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!found.length) throw new Error('Tidak ada "docs/SIW - Menu Matrix*.xlsx".');
  return found[0].full;
}

async function main() {
  loadEnv();
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")[0]));
  const apply = flags.has("apply");

  const parsed = parseMenuMatrix(resolveXlsx());
  const placeholders = parsed.summary.filter(
    (s) => s.status === "Recipe Pending" && (s.sellingPrice === null || s.sellingPrice === 0)
  );
  console.log(`Placeholder di workbook (Recipe Pending, tanpa harga): ${placeholders.length}`);

  const dbUrl = process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL;
  const host = parseHost(dbUrl);
  if (!isLocalDatabaseUrl(dbUrl) && !flags.has("allow-remote")) {
    throw new Error(`REFUSED: target "${host}" bukan localhost. Tambahkan --allow-remote.`);
  }
  if (apply && !isLocalDatabaseUrl(dbUrl) && !flags.has("confirm-remote")) {
    throw new Error(`REFUSED: --apply ke "${host}" butuh --confirm-remote.`);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: sslForUrl(dbUrl) });
  await client.connect();
  const nonaktif = [];
  const terjual = [];

  try {
    console.log(`Database : ${host} / ${(await client.query("SELECT current_database() db")).rows[0].db}`);
    console.log(`Mode     : ${apply ? "APPLY (COMMIT)" : "DRY-RUN (ROLLBACK)"}\n`);
    await client.query("BEGIN");

    const { rows: products } = await client.query(
      `SELECT p.id, p.kode, p.nama, p.is_active, p.harga_jual,
              pp.id AS pos_id, pp.sku, pp.is_active AS pos_active, pp.base_price,
              (SELECT count(*)::int FROM pos.pos_order_items oi WHERE oi.product_id = pp.id) AS terjual
         FROM item.products p
         LEFT JOIN pos.pos_products pp ON pp.source_product_id = p.id
        WHERE p.deleted_at IS NULL`
    );
    const byName = new Map(products.map((p) => [nkey(p.nama), p]));

    for (const ph of placeholders) {
      const p = byName.get(nkey(ph.name));
      if (!p) {
        console.log(`  ? ${ph.name} — tidak ada di database`);
        continue;
      }
      if (p.terjual > 0) {
        terjual.push({ ...p, status: ph.status });
        continue;
      }
      if (Number(p.harga_jual) > 0 || Number(p.base_price) > 0) {
        console.log(`  ! ${p.nama} — sudah punya harga, dilewati`);
        continue;
      }
      await client.query("UPDATE item.products SET is_active = false, updated_at = now() WHERE id = $1", [p.id]);
      if (p.pos_id) {
        await client.query(
          "UPDATE pos.pos_products SET is_active = false, is_available = false, updated_at = now() WHERE id = $1",
          [p.pos_id]
        );
      }
      nonaktif.push(p);
    }

    if (apply) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Dinonaktifkan (${nonaktif.length}):`);
  for (const p of nonaktif) console.log(`   ${p.kode.padEnd(22)} ${p.nama}`);
  if (terjual.length) {
    console.log(`\nTIDAK disentuh karena sudah terjual (${terjual.length}) — perlu dialihkan manual:`);
    for (const p of terjual) console.log(`   ${p.kode.padEnd(22)} ${p.nama} — ${p.terjual} baris order`);
  }
  console.log(apply ? "\nCOMMIT — perubahan tersimpan." : "\nDRY-RUN — tidak ada yang berubah.");
}

main().catch((error) => {
  console.error(`\nGAGAL: ${error.message}`);
  process.exitCode = 1;
});
