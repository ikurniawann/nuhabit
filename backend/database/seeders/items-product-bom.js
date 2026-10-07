#!/usr/bin/env node
/**
 * Seeder: demo produk BOM + sync ke pos.pos_products.
 *
 * - Upsert 5 menu demo (kode MENU-*) ke item.products (butuh warehouse_id)
 * - Replace manufacturing.bom_items dari bahan SULU yang sudah ada di DB
 * - Upsert pos.pos_products by SKU PUR-{kode}
 *
 * Idempotent. Scope: PROLOGE / SULU / SULU-DAGO.
 *
 * Usage:
 *   node database/seeders/items-product-bom.js
 *   pnpm db:seed:items-product-bom
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

/**
 * Menu demo + BOM dari bahan yang sudah ada di DB SULU.
 * components: [material_kode, qty, unit_kode]
 */
const DEMO_MENUS = [
  {
    kode: "MENU-RICE-001",
    nama: "Nasi Goreng Spesial",
    kategori: "RICE",
    satuan: "PORSI",
    modal: 12000,
    jual: 32000,
    deskripsi: "Nasi goreng dengan telur, ayam, dan acar",
    station: "kitchen",
    pos_category: "RICE",
    stall_code: "STALL-04",
    components: [
      ["BB-KERING-010", 0.25, "KG"], // Japonica Rice
      ["BB-DAGING-010", 0.08, "KG"], // Paha Ayam Fillet
      ["BB-DAGING-013", 1, "BUTIR"], // Telur Ayam Curah
      ["BB-OIL-001", 30, "ML"], // Minyak Goreng
      ["BB-SAUS-005", 15, "ML"], // Shoyu
      ["BB-SAYUR-002", 20, "GR"], // Bawang Bombay
      ["BB-SAYUR-003", 10, "GR"], // Bawang putih
    ],
  },
  {
    kode: "MENU-MAIN-004",
    nama: "Ayam Bakar",
    kategori: "MAIN",
    satuan: "PORSI",
    modal: 20000,
    jual: 45000,
    deskripsi: "Ayam bakar bumbu kecap",
    station: "kitchen",
    pos_category: "MAIN",
    stall_code: "STALL-02",
    components: [
      ["BB-DAGING-010", 0.35, "KG"],
      ["BB-SAUS-005", 25, "ML"],
      ["BB-SAUS-007", 15, "GR"], // Madu (master: GR/KG)
      ["BB-SAYUR-003", 10, "GR"],
      ["BB-OIL-001", 20, "ML"],
      ["BB-BUMBU-003", 5, "GR"], // Garam Refina
    ],
  },
  {
    kode: "MENU-APP-002",
    nama: "Chicken Wings",
    kategori: "APPETIZER",
    satuan: "PORSI",
    modal: 18000,
    jual: 40000,
    deskripsi: "Sayap ayam bumbu pedas",
    station: "kitchen",
    pos_category: "APPETIZER",
    stall_code: "STALL-02",
    components: [
      ["BB-DAGING-011", 0.25, "KG"], // Sayap Ayam
      ["BB-OIL-001", 50, "ML"],
      ["BB-SAUS-008", 20, "GR"], // Chili sauce (master: GR/KG)
      ["BB-BUMBU-003", 3, "GR"],
    ],
  },
  {
    kode: "MENU-COF-002",
    nama: "Cappuccino",
    kategori: "COFFEE",
    satuan: "CUP",
    modal: 8000,
    jual: 28000,
    deskripsi: "Espresso dengan susu dan foam (demo BOM: matcha + susu)",
    station: "bar",
    pos_category: "Minuman",
    stall_code: "STALL-05",
    components: [
      ["BB-KERING-011", 18, "GR"], // Matcha Powder (proxy biji kopi di data SULU)
      ["BB-DAIRY-003", 0.15, "L"], // Fresh Milk white
      ["BB-BUMBU-005", 10, "GR"], // Gula Putih
    ],
  },
  {
    kode: "MENU-TEA-001",
    nama: "Hot Tea",
    kategori: "TEA",
    satuan: "CUP",
    modal: 3000,
    jual: 12000,
    deskripsi: "Teh panas (demo BOM: hojicha)",
    station: "bar",
    pos_category: "Minuman",
    stall_code: "STALL-05",
    components: [
      ["BB-KERING-007", 5, "GR"], // Hojicha Powder
      ["BB-BUMBU-005", 10, "GR"],
      ["BB-MINUMAN-001", 0.2, "L"], // Air
    ],
  },
];

async function loadUnitMap(c) {
  const { rows } = await c.query(
    "SELECT id, kode FROM item.units WHERE deleted_at IS NULL"
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.kode)) map.set(row.kode, row.id);
  }
  return map;
}

async function loadWarehouseMap(c, branchId) {
  const { rows } = await c.query(
    `SELECT id, code, name
     FROM configuration.warehouses
     WHERE branch_id = $1 AND is_active = true`,
    [branchId]
  );
  return new Map(rows.map((r) => [r.code, r]));
}

async function ensureProductCategories(c) {
  const codes = [...new Set(DEMO_MENUS.map((m) => m.kategori))];
  for (const code of codes) {
    await c.query(
      `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
       VALUES ($1, $1, $2, NULL, true)
       ON CONFLICT (code) WHERE company_id IS NULL AND deleted_at IS NULL DO UPDATE
         SET is_active = true,
             deleted_at = NULL,
             updated_at = NOW()`,
      [code, `Kategori demo ${code}`]
    );
  }
}

async function loadMaterialMap(c, scope) {
  const kodes = [
    ...new Set(DEMO_MENUS.flatMap((m) => m.components.map(([kode]) => kode))),
  ];
  const { rows } = await c.query(
    `SELECT id, kode, nama
     FROM item.raw_materials
     WHERE deleted_at IS NULL
       AND kode = ANY($1::text[])
       AND company_id = $2
       AND branch_id = $3`,
    [kodes, scope.company_id, scope.branch_id]
  );
  return new Map(rows.map((r) => [r.kode, r]));
}

async function upsertProduct(c, menu, scope, unitId, warehouseId) {
  const markup =
    menu.modal > 0 ? Math.round(((menu.jual - menu.modal) / menu.modal) * 100) : 0;

  const { rows } = await c.query(
    `INSERT INTO item.products
       (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, markup_persen,
        company_id, branch_id, warehouse_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
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
       harga_modal = EXCLUDED.harga_modal,
       markup_persen = EXCLUDED.markup_persen,
       is_active = true,
       deleted_at = NULL,
       updated_at = NOW()
     RETURNING id, kode, nama, deskripsi, kategori, harga_jual, harga_modal, is_active`,
    [
      menu.kode,
      menu.nama,
      menu.deskripsi,
      menu.kategori,
      unitId,
      menu.jual,
      menu.modal,
      markup,
      scope.company_id,
      scope.branch_id,
      warehouseId,
    ]
  );
  return rows[0];
}

async function findOrCreatePosCategory(c, name) {
  const existing = await c.query(
    `SELECT id FROM pos.pos_categories
     WHERE lower(name) = lower($1)
     LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await c.query(
    `INSERT INTO pos.pos_categories (name, is_active)
     VALUES ($1, true)
     RETURNING id`,
    [name]
  );
  return created.rows[0].id;
}

async function upsertPosProduct(c, product, menu) {
  const sku = `PUR-${product.kode}`;
  const categoryId = await findOrCreatePosCategory(c, menu.pos_category);
  const result = await c.query(
    `INSERT INTO pos.pos_products
       (sku, name, description, category_id, base_price, cost_price,
        is_active, is_available, inventory_tracking, station, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, $8, NOW())
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category_id = EXCLUDED.category_id,
       base_price = EXCLUDED.base_price,
       cost_price = EXCLUDED.cost_price,
       is_active = EXCLUDED.is_active,
       is_available = EXCLUDED.is_available,
       inventory_tracking = EXCLUDED.inventory_tracking,
       station = EXCLUDED.station,
       updated_at = NOW()
     RETURNING id, sku, name, (xmax = 0) AS inserted`,
    [
      sku,
      product.nama || sku,
      product.deskripsi || `Synced from Purchasing product ${product.kode}`,
      categoryId,
      Number(product.harga_jual) || 0,
      Number(product.harga_modal) || 0,
      product.is_active !== false,
      menu.station,
    ]
  );
  return result.rows[0];
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
    const unitMap = await loadUnitMap(c);
    const warehouseMap = await loadWarehouseMap(c, scope.branch_id);
    const materialMap = await loadMaterialMap(c, scope);

    const uid = (code) => {
      const id = unitMap.get(code);
      if (!id) {
        throw new Error(
          `Unit "${code}" tidak ditemukan. Jalankan dulu: pnpm db:seed:items-units`
        );
      }
      return id;
    };

    const neededMaterials = [
      ...new Set(DEMO_MENUS.flatMap((m) => m.components.map(([kode]) => kode))),
    ];
    const missingMaterials = neededMaterials.filter((k) => !materialMap.has(k));
    if (missingMaterials.length) {
      throw new Error(
        `Bahan baku SULU belum ada: ${missingMaterials.join(", ")}`
      );
    }

    await ensureProductCategories(c);

    console.log(
      `Seeding demo BOM + POS (${scope.company_name} / ${scope.branch_name})...`
    );

    let bomCount = 0;
    for (const menu of DEMO_MENUS) {
      const warehouse =
        warehouseMap.get(menu.stall_code) ||
        warehouseMap.get("STALL-03") ||
        [...warehouseMap.values()][0];
      if (!warehouse) {
        throw new Error(
          "Warehouse/stall tidak ditemukan. Jalankan dulu: pnpm db:seed:business-stalls"
        );
      }

      const product = await upsertProduct(
        c,
        menu,
        scope,
        uid(menu.satuan),
        warehouse.id
      );

      const materialIds = menu.components.map(([mk]) => materialMap.get(mk).id);
      await c.query(
        `DELETE FROM manufacturing.bom_items
         WHERE product_id = $1
           AND raw_material_id = ANY($2::uuid[])`,
        [product.id, materialIds]
      );

      for (const [materialKode, qty, unitKode] of menu.components) {
        const material = materialMap.get(materialKode);
        await c.query(
          `INSERT INTO manufacturing.bom_items
             (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
           VALUES ($1, $2, $3, $4, 0, true)`,
          [product.id, material.id, qty, uid(unitKode)]
        );
        bomCount += 1;
      }

      const pos = await upsertPosProduct(c, product, menu);
      const mode = pos.inserted ? "created" : "updated";
      console.log(
        `  ✓ ${menu.kode} — ${menu.nama} (${menu.components.length} BOM) @ ${warehouse.code} → POS ${pos.sku} [${mode}]`
      );
    }

    await c.query("COMMIT");
    console.log(
      `\nSelesai: ${DEMO_MENUS.length} produk, ${bomCount} baris BOM, sync POS OK`
    );
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
