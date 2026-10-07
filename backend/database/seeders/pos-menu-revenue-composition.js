#!/usr/bin/env node
/**
 * Seeder terarah: menu POS "Komposisi Pendapatan".
 *
 *   node database/seeders/pos-menu-revenue-composition.js                        # dry-run lokal
 *   node database/seeders/pos-menu-revenue-composition.js --apply
 *   node database/seeders/pos-menu-revenue-composition.js --allow-remote --apply --confirm-remote
 *
 * Kenapa terpisah dari `iam-menus.sql`: seeder kanonik itu diakhiri statement
 * yang men-soft-delete SETIAP menu di luar whitelist-nya. Di server-sulu ada 15
 * menu hidup yang tidak ada di whitelist tersebut (shop, promo, pos.settings,
 * settings.billing, dst), sehingga menjalankannya di produksi akan menyapu
 * menu-menu itu. Skrip ini hanya menyisipkan satu menu dan hak aksesnya.
 *
 * Hak akses tidak ditebak: disalin apa adanya dari `pos.reports.profit`
 * (role, granted_actions, is_active) supaya menu baru mengikuti kebijakan yang
 * sudah berlaku untuk laporan POS lain.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { parseHost, isLocalDatabaseUrl, sslForUrl } = require("../scripts/pg-utils");

const MENU = {
  code: "pos.reports.revenue-composition",
  menu_name: "Komposisi Pendapatan",
  route_path: "/dashboard/pos/reports/revenue-composition",
  icon: "chart-pie",
  menu_type: "sidebar",
  order_number: 21,
  permission_context: { actions: ["read"] },
};
const PARENT_CODE = "pos.reports";
const TEMPLATE_CODE = "pos.reports.profit";

function loadEnv() {
  const root = path.resolve(__dirname, "../..");
  for (const file of [".env", ".env.local"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
    }
  }
}

async function main() {
  loadEnv();
  const flags = new Set(
    process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, ""))
  );
  const apply = flags.has("apply");

  const url =
    (flags.has("allow-remote") ? process.env.AUDIT_DATABASE_URL : null) ||
    process.env.MIGRATE_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL / MIGRATE_DATABASE_URL belum diset.");

  const host = parseHost(url);
  if (!isLocalDatabaseUrl(url) && !flags.has("allow-remote")) {
    throw new Error(`REFUSED: target "${host}" bukan localhost. Tambahkan --allow-remote.`);
  }
  if (apply && !isLocalDatabaseUrl(url) && !flags.has("confirm-remote")) {
    throw new Error(`REFUSED: --apply ke "${host}" butuh --confirm-remote.`);
  }

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();
  const log = [];

  try {
    const dbName = (await client.query("SELECT current_database() AS db")).rows[0].db;
    console.log(`Database : ${host} / ${dbName}`);
    console.log(`Mode     : ${apply ? "APPLY (COMMIT)" : "DRY-RUN (ROLLBACK)"}\n`);

    await client.query("BEGIN");

    const parent = await client.query(
      "SELECT id FROM iam.menus WHERE code = $1 AND deleted_at IS NULL",
      [PARENT_CODE]
    );
    if (!parent.rows[0]) throw new Error(`Menu induk "${PARENT_CODE}" tidak ditemukan.`);

    const before = await client.query("SELECT id, deleted_at FROM iam.menus WHERE code = $1", [
      MENU.code,
    ]);

    const upsert = await client.query(
      `INSERT INTO iam.menus
         (code, menu_name, route_path, icon, menu_type, order_number, permission_context,
          module, level, parent_id, is_active, is_visible)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'pos',3,$8,true,true)
       ON CONFLICT (code) DO UPDATE SET
         menu_name          = EXCLUDED.menu_name,
         route_path         = EXCLUDED.route_path,
         icon               = EXCLUDED.icon,
         menu_type          = EXCLUDED.menu_type,
         order_number       = EXCLUDED.order_number,
         permission_context = EXCLUDED.permission_context,
         module             = EXCLUDED.module,
         level              = EXCLUDED.level,
         parent_id          = EXCLUDED.parent_id,
         is_active          = true,
         is_visible         = true,
         deleted_at         = NULL,
         updated_at         = now()
       RETURNING id`,
      [
        MENU.code,
        MENU.menu_name,
        MENU.route_path,
        MENU.icon,
        MENU.menu_type,
        MENU.order_number,
        JSON.stringify(MENU.permission_context),
        parent.rows[0].id,
      ]
    );
    const menuId = upsert.rows[0].id;
    log.push(
      before.rows[0]
        ? `menu   diperbarui  ${MENU.code}${before.rows[0].deleted_at ? " (dipulihkan dari terhapus)" : ""}`
        : `menu   dibuat      ${MENU.code}`
    );

    const grants = await client.query(
      `INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
       SELECT rmp.role_id, $2, rmp.granted_actions, rmp.is_active
         FROM iam.role_menu_permissions rmp
         JOIN iam.menus m ON m.id = rmp.menu_id
        WHERE m.code = $1
       ON CONFLICT (role_id, menu_id) DO UPDATE SET
         granted_actions = EXCLUDED.granted_actions,
         is_active       = EXCLUDED.is_active,
         updated_at      = now()
       RETURNING role_id`,
      [TEMPLATE_CODE, menuId]
    );
    log.push(`akses  ${String(grants.rowCount).padStart(2)} role disalin dari ${TEMPLATE_CODE}`);

    const roles = await client.query(
      `SELECT r.name, rmp.granted_actions, rmp.is_active
         FROM iam.role_menu_permissions rmp
         JOIN iam.roles r ON r.id = rmp.role_id
        WHERE rmp.menu_id = $1
        ORDER BY r.name`,
      [menuId]
    );

    const total = await client.query(
      "SELECT count(*)::int n FROM iam.menus WHERE deleted_at IS NULL"
    );

    for (const line of log) console.log(`  ${line}`);
    console.log("\n  Hak akses menu ini:");
    for (const r of roles.rows) {
      console.log(
        `    ${r.name.padEnd(20)}${r.is_active ? "aktif  " : "nonaktif"}  ${r.granted_actions.join(", ")}`
      );
    }
    console.log(`\n  Menu aktif di database: ${total.rows[0].n}`);

    if (apply) await client.query("COMMIT");
    else await client.query("ROLLBACK");
    console.log(apply ? "\nCOMMIT — perubahan tersimpan." : "\nDRY-RUN — tidak ada yang berubah.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nGAGAL: ${error.message}`);
  process.exitCode = 1;
});
