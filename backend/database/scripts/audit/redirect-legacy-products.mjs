#!/usr/bin/env node
/**
 * Alihkan produk bernama lama ke produk aktif hasil Menu Matrix, lalu
 * nonaktifkan produk lamanya.
 *
 *   node scripts/audit/redirect-legacy-products.mjs --allow-remote
 *   node scripts/audit/redirect-legacy-products.mjs --allow-remote --apply --confirm-remote
 *
 * Pemetaan ditulis eksplisit di REDIRECTS — tidak ada tebakan otomatis, karena
 * workbook memecah beberapa menu jadi banyak varian berharga beda.
 *
 * Baris order dipindah HANYA bila `product_name`-nya memang sama dengan produk
 * asal. Baris yang `product_id`-nya sudah salah tunjuk sejak awal (mis. order
 * "Steam Rice" yang menunjuk produk "Hikiniku") tidak ikut dipindah — itu
 * masalah terpisah dan hanya dilaporkan.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { parseHost, isLocalDatabaseUrl, sslForUrl } = require(
  path.join(BACKEND_ROOT, "database/scripts/pg-utils.js")
);

/** Produk lama → produk aktif tujuan. */
const REDIRECTS = [
  { dari: "Hikiniku", ke: "Beef Hikiniku" },
  { dari: "Okayu Beef", ke: "Beef Okayu" },
];

/** Produk lama tanpa riwayat penjualan — cukup dinonaktifkan. */
const DEACTIVATE = [
  "Onigiri Spicy Tuna",
  "Onigiri Yakiniku",
  "Onigiri Butter Cakalang",
  "Onigiri Chili Oil",
];

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

const money = (v) => Number(v || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });

async function main() {
  loadEnv();
  const flags = new Set(
    process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")[0])
  );
  const apply = flags.has("apply");

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
  const log = [];
  let mislinked = [];

  try {
    console.log(`Database : ${host} / ${(await client.query("SELECT current_database() db")).rows[0].db}`);
    console.log(`Mode     : ${apply ? "APPLY (COMMIT)" : "DRY-RUN (ROLLBACK)"}\n`);
    await client.query("BEGIN");

    const posByName = new Map(
      (await client.query("SELECT id, sku, name, base_price, cost_price, is_active, source_product_id FROM pos.pos_products")).rows.map(
        (r) => [r.name.trim().toLowerCase(), r]
      )
    );

    for (const { dari, ke } of REDIRECTS) {
      const src = posByName.get(dari.toLowerCase());
      const dst = posByName.get(ke.toLowerCase());
      if (!src || !dst) {
        console.log(`  ! ${dari} → ${ke}: salah satu tidak ditemukan, dilewati`);
        continue;
      }

      const moved = await client.query(
        `UPDATE pos.pos_order_items oi
            SET product_id = $2,
                product_name = $3,
                product_sku = $4,
                cost_price = $5,
                cost_total = $5 * oi.quantity,
                gross_profit = oi.total_amount - ($5 * oi.quantity),
                gross_margin_pct = CASE WHEN oi.total_amount > 0
                     THEN greatest(-999999.99, least(999999.99,
                          round((((oi.total_amount - ($5 * oi.quantity)) / oi.total_amount) * 100)::numeric, 2)))
                     ELSE 0 END,
                updated_at = now()
          WHERE oi.product_id = $1
            AND lower(trim(oi.product_name)) = lower(trim($6))
          RETURNING oi.id`,
        [src.id, dst.id, dst.name, dst.sku, dst.cost_price, dari]
      );

      await client.query(
        "UPDATE pos.pos_products SET is_active = false, is_available = false, updated_at = now() WHERE id = $1",
        [src.id]
      );
      if (src.source_product_id) {
        await client.query("UPDATE item.products SET is_active = false, updated_at = now() WHERE id = $1", [
          src.source_product_id,
        ]);
      }
      log.push(
        `alihkan  ${dari} → ${ke}: ${moved.rowCount} baris order dipindah (HPP jadi ${money(dst.cost_price)}/porsi), produk lama dinonaktifkan`
      );
    }

    for (const nama of DEACTIVATE) {
      const src = posByName.get(nama.toLowerCase());
      if (!src) {
        console.log(`  ! ${nama}: tidak ditemukan, dilewati`);
        continue;
      }
      const { rows } = await client.query(
        "SELECT count(*)::int n FROM pos.pos_order_items WHERE product_id = $1",
        [src.id]
      );
      if (rows[0].n > 0) {
        console.log(`  ! ${nama}: ternyata punya ${rows[0].n} baris order — TIDAK dinonaktifkan`);
        continue;
      }
      await client.query(
        "UPDATE pos.pos_products SET is_active = false, is_available = false, updated_at = now() WHERE id = $1",
        [src.id]
      );
      if (src.source_product_id) {
        await client.query("UPDATE item.products SET is_active = false, updated_at = now() WHERE id = $1", [
          src.source_product_id,
        ]);
      }
      log.push(`nonaktif ${nama}: tanpa riwayat penjualan`);
    }

    mislinked = (
      await client.query(
        `SELECT oi.product_name AS nama_order, oi.product_sku AS sku_order,
                pp.name AS nama_katalog, pp.sku AS sku_katalog,
                count(*)::int AS baris, sum(oi.quantity)::int AS qty,
                round(sum(oi.total_amount)::numeric, 0) AS omzet
           FROM pos.pos_order_items oi
           JOIN pos.pos_products pp ON pp.id = oi.product_id
          WHERE lower(trim(oi.product_name)) <> lower(trim(pp.name))
          GROUP BY 1, 2, 3, 4
          ORDER BY 5 DESC`
      )
    ).rows;

    if (apply) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  for (const line of log) console.log(`  ${line}`);

  const outDir = path.join(BACKEND_ROOT, "..", "docs/audit/menu-matrix-remediasi");
  fs.mkdirSync(outDir, { recursive: true });
  const cell = (v) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = ["nama_di_order,sku_di_order,nama_di_katalog,sku_di_katalog,baris,qty,omzet"];
  for (const r of mislinked) {
    rows.push([r.nama_order, r.sku_order, r.nama_katalog, r.sku_katalog, r.baris, r.qty, r.omzet].map(cell).join(","));
  }
  fs.writeFileSync(path.join(outDir, "order-linkage-mencurigakan.csv"), `﻿${rows.join("\n")}\n`, "utf8");

  console.log(`\n${mislinked.length} pasangan nama order ≠ nama katalog → docs/audit/menu-matrix-remediasi/order-linkage-mencurigakan.csv`);
  console.log(apply ? "COMMIT — perubahan tersimpan." : "DRY-RUN — tidak ada yang berubah.");
}

main().catch((error) => {
  console.error(`\nGAGAL: ${error.message}`);
  process.exitCode = 1;
});
