#!/usr/bin/env node
/**
 * Seeder: menu BCD Coffee (Brewcode Coffee Dose) — sumber: papan menu resmi
 * outlet Sukakarya, 2026-09-28.
 *
 * Mengisi dua sisi katalog sekaligus, karena POS butuh keduanya:
 *   - item.product_categories + item.products  (katalog, laporan stok, stall)
 *   - pos.pos_categories + pos.pos_products     (tampilan kasir)
 * lalu menautkan pos_products.source_product_id → item.products.id. Tanpa
 * tautan itu produk dianggap "tanpa stall" dan POS menolak memasukkannya ke
 * transaksi (lihat bcdcoffee-pos-product-stall.js).
 *
 * Bagian OTHERS di menu dimodelkan sebagai modifier (add-on) yang dibagi
 * beberapa produk, bukan produk terpisah — kasir memilihnya dari popup
 * kustomisasi saat menambahkan minuman.
 *
 * Idempotent & "replace": upsert per SKU/kode; produk dan kategori lain yang
 * TIDAK ada di menu ini dinonaktifkan (bukan dihapus), supaya transaksi lama
 * yang mengacu ke produk tersebut tetap utuh.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-menu.js
 *   npm run db:seed:bcdcoffee-menu
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { resolveSeedBusinessScope } = require("../scripts/items-business-scope");

const ROOT = path.join(__dirname, "..", "..");

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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

const ONE_LITRE_NOTE = "1-litre pack, best consumed within 5 days from the production date.";

/**
 * Urutan kategori = urutan di papan menu. `sku` = prefiks SKU produk.
 * Harga dalam rupiah, persis seperti papan menu.
 */
const MENU = [
  {
    code: "SIGNATURE-PALM-SUGAR",
    name: "Signature Palm Sugar Series",
    sku: "PALM",
    description:
      "Crafted with 100% arabica beans, blended with premium non-dairy creamer and authentic palm sugar. " +
      "Choose Bold for a stronger, richer coffee taste, or Light for a sweeter profile with a smooth hint of butterscotch.",
    items: [
      { name: "Iced Bold", price: 23000, description: "Stronger, richer coffee taste." },
      { name: "1 Litre Iced Bold", price: 90000, unit: "BTL", description: `Stronger, richer coffee taste. ${ONE_LITRE_NOTE}` },
      { name: "Iced Light", price: 25000, description: "Sweeter profile with a smooth hint of butterscotch." },
      { name: "1 Litre Iced Light", price: 100000, unit: "BTL", description: `Sweeter profile with a smooth hint of butterscotch. ${ONE_LITRE_NOTE}` },
    ],
  },
  {
    code: "BLACK",
    name: "Black Series",
    sku: "BLACK",
    description:
      "Crafted with your choice of regular or special beans. All made from 100% premium arabica for a richer, smoother experience.",
    items: [
      { name: "Espresso", price: 15000 },
      { name: "On The Rock", price: 20000 },
      { name: "Iced Black", price: 25000 },
      { name: "Hot Black", price: 25000 },
      { name: "Iced Orange Black", price: 28000 },
      { name: "Iced Apple Black", price: 28000 },
    ],
  },
  {
    code: "WHITE",
    name: "White Series",
    sku: "WHITE",
    description:
      "Crafted with your choice of regular or special beans. All made from 100% premium arabica for a richer, smoother experience.",
    items: [
      { name: "Dirty Latte", price: 25000 },
      { name: "Iced Latte", price: 25000 },
      { name: "Iced Cappuccino", price: 25000 },
      { name: "Iced Magic", price: 25000 },
      { name: "Iced Mochaccino", price: 28000 },
      { name: "Iced Mont Blanc", price: 30000 },
      { name: "Hot Latte", price: 25000 },
      { name: "Hot Cappuccino", price: 25000 },
      { name: "Hot Magic", price: 25000 },
      { name: "Hot Mochaccino", price: 25000 },
    ],
  },
  {
    code: "MANUAL-BREW",
    name: "Manual Brew Series",
    sku: "BREW",
    description:
      "Ask our barista about the availability of filter beans. When available, choose between our regular or special selections.",
    items: [
      { name: "Hot Filter", price: 20000 },
      { name: "Hot Vietnam Drip", price: 20000 },
      { name: "Iced Filter", price: 25000 },
      { name: "Iced Vietnam Drip", price: 25000 },
    ],
  },
  {
    code: "CLASSIC-FINE-ROBUSTA",
    name: "Classic Fine Robusta Series",
    sku: "ROBUSTA",
    description:
      "Crafted with 100% fine robusta beans, bold and full-bodied. Our sweet menu is complemented with rich, creamy condensed milk.",
    items: [
      { name: "Hot Black Classic", price: 10000 },
      { name: "Iced Black Classic", price: 10000 },
      { name: "Hot Sweet Classic", price: 12000 },
      { name: "Iced Sweet Classic", price: 15000 },
      { name: "Iced Palm Classic", price: 15000 },
    ],
  },
  {
    code: "NON-COFFEE",
    name: "Non-Coffee Series",
    sku: "NONCOF",
    description: "Matcha and chocolate drinks, no coffee.",
    items: [
      { name: "Iced Matcha", price: 25000 },
      { name: "Iced Matcha Strawberry", price: 30000 },
      { name: "Iced Chocolate", price: 25000 },
      { name: "Hot Matcha", price: 22000 },
      { name: "Hot Chocolate", price: 22000 },
    ],
  },
];

/**
 * Bagian OTHERS. `appliesTo` = kode kategori (seluruh isinya) dan/atau nama
 * produk. Penempatan mengikuti teks menu: "regular or special beans" di Black,
 * White, Manual Brew; extra shot untuk minuman berbasis espresso; oat milk
 * untuk minuman bersusu; grade matcha untuk minuman matcha.
 */
const ADDONS = [
  {
    group: "Pilihan Biji Kopi",
    modifier: "Special Beans",
    price: 10000,
    appliesTo: { categories: ["BLACK", "WHITE", "MANUAL-BREW"] },
  },
  {
    group: "Tambahan Espresso",
    modifier: "Extra Shot Espresso",
    price: 10000,
    appliesTo: { categories: ["BLACK", "WHITE"], products: ["Iced Bold", "Iced Light"] },
  },
  {
    group: "Pilihan Susu",
    modifier: "Oat Milk",
    price: 5000,
    appliesTo: { categories: ["WHITE", "NON-COFFEE"] },
  },
  {
    group: "Grade Matcha",
    modifier: "Ceremonial Matcha Grade",
    price: 10000,
    appliesTo: { products: ["Iced Matcha", "Iced Matcha Strawberry", "Hot Matcha"] },
  },
];

const UPSERT_ITEM_PRODUCT_SQL = `
  INSERT INTO item.products
    (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, station,
     production_output_type, warehouse_id, company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, 0, 'bar', 'FINISHED_GOOD', $7, $8, $9, true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    warehouse_id,
    kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET
    nama = EXCLUDED.nama,
    deskripsi = EXCLUDED.deskripsi,
    kategori = EXCLUDED.kategori,
    satuan_id = EXCLUDED.satuan_id,
    harga_jual = EXCLUDED.harga_jual,
    station = EXCLUDED.station,
    is_active = true,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id
`;

const UPSERT_POS_PRODUCT_SQL = `
  INSERT INTO pos.pos_products
    (sku, name, description, category_id, base_price, station, source_product_id, is_active, is_available)
  VALUES ($1, $2, $3, $4, $5, 'bar', $6, true, true)
  ON CONFLICT (sku) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category_id = EXCLUDED.category_id,
    base_price = EXCLUDED.base_price,
    station = EXCLUDED.station,
    source_product_id = EXCLUDED.source_product_id,
    is_active = true,
    is_available = true,
    updated_at = NOW()
  RETURNING id
`;

async function resolveStall(c, branchId) {
  const { rows } = await c.query(
    `SELECT id, code, name FROM configuration.warehouses
     WHERE branch_id = $1 AND is_active
     ORDER BY created_at
     LIMIT 1`,
    [branchId]
  );
  if (!rows[0]) throw new Error("Belum ada stall/gudang aktif untuk cabang ini.");
  return rows[0];
}

async function unitIds(c) {
  const { rows } = await c.query(`SELECT id, upper(kode) AS kode FROM item.units WHERE upper(kode) IN ('CUP', 'BTL')`);
  const map = new Map(rows.map((r) => [r.kode, r.id]));
  return { CUP: map.get("CUP") ?? null, BTL: map.get("BTL") ?? null };
}

/** pos_categories tidak punya kunci unik — cocokkan per nama. */
async function upsertPosCategory(c, name, order) {
  const { rows } = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1`, [name]);
  if (rows[0]) {
    await c.query(
      `UPDATE pos.pos_categories SET name = $2, display_order = $3, is_active = true, parent_id = NULL, updated_at = NOW() WHERE id = $1`,
      [rows[0].id, name, order]
    );
    return rows[0].id;
  }
  const ins = await c.query(
    `INSERT INTO pos.pos_categories (name, display_order, is_active) VALUES ($1, $2, true) RETURNING id`,
    [name, order]
  );
  return ins.rows[0].id;
}

async function upsertModifierGroup(c, group, modifier, price, order) {
  let groupId;
  const { rows } = await c.query(`SELECT id FROM pos.pos_modifier_groups WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1`, [group]);
  if (rows[0]) {
    groupId = rows[0].id;
    await c.query(
      `UPDATE pos.pos_modifier_groups SET min_selection = 0, max_selection = 1, display_order = $2, is_active = true WHERE id = $1`,
      [groupId, order]
    );
  } else {
    const ins = await c.query(
      `INSERT INTO pos.pos_modifier_groups (name, min_selection, max_selection, display_order, is_active)
       VALUES ($1, 0, 1, $2, true) RETURNING id`,
      [group, order]
    );
    groupId = ins.rows[0].id;
  }
  const mod = await c.query(`SELECT id FROM pos.pos_modifiers WHERE group_id = $1 AND lower(name) = lower($2) LIMIT 1`, [groupId, modifier]);
  if (mod.rows[0]) {
    await c.query(`UPDATE pos.pos_modifiers SET price_adjustment = $2, is_active = true WHERE id = $1`, [mod.rows[0].id, price]);
  } else {
    await c.query(
      `INSERT INTO pos.pos_modifiers (group_id, name, price_adjustment, display_order, is_active) VALUES ($1, $2, $3, 0, true)`,
      [groupId, modifier, price]
    );
  }
  return groupId;
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL di .env / .env.local");
    process.exit(1);
  }
  try {
    assertLocalTarget(url, "MIGRATE_DATABASE_URL");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await resolveSeedBusinessScope(c);
    const stall = await resolveStall(c, scope.branch_id);
    const units = await unitIds(c);
    console.log(`Menu → ${scope.company_name} / ${scope.branch_name} / stall ${stall.name}`);

    const menuSkus = [];
    const menuItemCodes = [];
    const menuCategoryCodes = [];
    const menuPosCategoryIds = [];
    const productIdsByCategory = new Map();
    const productIdsByName = new Map();

    for (const [ci, cat] of MENU.entries()) {
      await c.query(
        `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL AND company_id IS NOT NULL
         DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, is_active = true,
                       deleted_at = NULL, updated_at = NOW()`,
        [cat.code, cat.name, cat.description, scope.company_id]
      );
      menuCategoryCodes.push(cat.code);
      const posCategoryId = await upsertPosCategory(c, cat.name, ci + 1);
      menuPosCategoryIds.push(posCategoryId);
      productIdsByCategory.set(cat.code, []);

      for (const [pi, item] of cat.items.entries()) {
        const sku = `BCD-${cat.sku}-${String(pi + 1).padStart(2, "0")}`;
        const description = item.description ?? null;
        const unitId = units[item.unit ?? "CUP"];
        const { rows } = await c.query(UPSERT_ITEM_PRODUCT_SQL, [
          sku,
          item.name,
          description,
          cat.code,
          unitId,
          item.price,
          stall.id,
          scope.company_id,
          scope.branch_id,
        ]);
        const itemId = rows[0].id;
        const pos = await c.query(UPSERT_POS_PRODUCT_SQL, [sku, item.name, description, posCategoryId, item.price, itemId]);
        const posId = pos.rows[0].id;
        productIdsByCategory.get(cat.code).push(posId);
        productIdsByName.set(item.name, posId);
        menuSkus.push(sku);
        menuItemCodes.push(sku);
        console.log(`  ✓ ${sku.padEnd(16)} ${item.name.padEnd(24)} Rp ${item.price.toLocaleString("id-ID")}`);
      }
    }

    console.log("Add-on (OTHERS):");
    for (const [ai, addon] of ADDONS.entries()) {
      const groupId = await upsertModifierGroup(c, addon.group, addon.modifier, addon.price, ai + 1);
      const targets = new Set();
      for (const code of addon.appliesTo.categories ?? []) {
        for (const id of productIdsByCategory.get(code) ?? []) targets.add(id);
      }
      for (const name of addon.appliesTo.products ?? []) {
        const id = productIdsByName.get(name);
        if (!id) throw new Error(`Add-on "${addon.modifier}" menunjuk produk yang tidak ada: ${name}`);
        targets.add(id);
      }
      // Tautan grup ini disusun ulang persis sesuai menu.
      await c.query(`DELETE FROM pos.pos_product_modifiers WHERE modifier_group_id = $1`, [groupId]);
      for (const productId of targets) {
        await c.query(
          `INSERT INTO pos.pos_product_modifiers (product_id, modifier_group_id) VALUES ($1, $2)
           ON CONFLICT (product_id, modifier_group_id) DO NOTHING`,
          [productId, groupId]
        );
      }
      console.log(`  ✓ ${addon.modifier.padEnd(24)} +Rp ${addon.price.toLocaleString("id-ID")} → ${targets.size} produk`);
    }

    // "Replace": yang tidak ada di menu dinonaktifkan, bukan dihapus.
    const offPos = await c.query(
      `UPDATE pos.pos_products SET is_active = false, is_available = false, updated_at = NOW()
       WHERE is_active AND NOT (sku = ANY($1::text[]))`,
      [menuSkus]
    );
    const offItem = await c.query(
      `UPDATE item.products SET is_active = false, updated_at = NOW()
       WHERE is_active AND company_id = $1 AND production_output_type = 'FINISHED_GOOD'
         AND NOT (kode = ANY($2::text[]))`,
      [scope.company_id, menuItemCodes]
    );
    const offCat = await c.query(
      `UPDATE item.product_categories SET is_active = false, updated_at = NOW()
       WHERE is_active AND company_id = $1 AND NOT (code = ANY($2::text[]))`,
      [scope.company_id, menuCategoryCodes]
    );
    const offPosCat = await c.query(
      `UPDATE pos.pos_categories SET is_active = false, updated_at = NOW()
       WHERE is_active AND NOT (id = ANY($1::uuid[]))`,
      [menuPosCategoryIds]
    );
    const offGroups = await c.query(
      `UPDATE pos.pos_modifier_groups SET is_active = false
       WHERE is_active AND NOT (lower(name) = ANY($1::text[]))`,
      [ADDONS.map((a) => a.group.toLowerCase())]
    );
    console.log(
      `Dinonaktifkan (tidak ada di menu): ${offPos.rowCount} produk POS, ${offItem.rowCount} produk katalog, ` +
        `${offCat.rowCount + offPosCat.rowCount} kategori, ${offGroups.rowCount} grup add-on.`
    );

    await c.query("COMMIT");
    const total = MENU.reduce((n, cat) => n + cat.items.length, 0);
    console.log(`Selesai: ${MENU.length} kategori, ${total} produk, ${ADDONS.length} add-on.`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("GAGAL, semua perubahan di-rollback:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
