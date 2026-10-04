#!/usr/bin/env node
/**
 * Seeder demo TICKETING (data lokal, permintaan owner 2026-09-06):
 * memunculkan modul Ticketing di dashboard lokal + data contoh lengkap.
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - iam.menus ticketing.*            : diaktifkan & di-grant ke super_admin + admin
 *   - crm.crm_settings                 : default_company_id / default_branch_id (venue) bila kosong
 *   - ticketing.ticket_settings        : kebijakan venue (re-entry, kredit, slug booking, kuota harian)
 *   - ticket_channels / ticket_categories / ticket_time_slots / ticket_capacity_dates
 *   - ticket_products (+variants, distribusi kanal, harga per kanal, high season, bundle, pass config)
 *   - ticket_bands                     : 24 gelang NFC (tersedia / dipakai / karyawan)
 *   - ticket_bookings (+items, guests) : 8 booking online berbagai status
 *   - ticket_visits (+bands, charges, gate_events) : kunjungan selesai & berjalan
 *   - ticket_season_passes (+pass_entries) : season pass aktif / menunggu bayar / kedaluwarsa
 *   - ticket_staff_passes              : 2 gelang karyawan
 *
 * Venue = crm_settings default_company_id/default_branch_id (yang dipakai
 * super admin), fallback scope Sulu/Dago. Data demo bertanda DEMO- agar bisa
 * dihapus & diisi ulang saat seeder dijalankan lagi.
 *
 * Usage:  npm run db:seed:ticketing-demo
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

const MENU_ROLES = ["super_admin", "admin"];
const ymd = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 86400000);
const token = () => crypto.randomBytes(32).toString("hex");

const CHANNELS = [
  ["walk-in", "Walk-in (Loket)", false, 10],
  ["website", "Website Booking", true, 20],
];
const CATEGORIES = ["Tiket Masuk", "Wahana", "Paket"];
const TIME_SLOTS = [
  ["Pagi (09.00–12.00)", "09:00", "12:00", 300, 10],
  ["Siang (12.00–15.00)", "12:00", "15:00", 300, 20],
  ["Sore (15.00–18.00)", "15:00", "18:00", 250, 30],
];

// [code, name, kategori, kind, has_gate, base_price, cogs, re_entry, deskripsi, variants[[code,name,regular,high]]]
const PRODUCTS = [
  ["DEMO-MASUK", "Tiket Masuk Reguler", "Tiket Masuk", "single", true, 50000, 5000, "bebas-keluar-masuk",
    "Akses seluruh area taman, berlaku 1 hari. Harga high season berlaku di libur akhir tahun.",
    [["DEWASA", "Dewasa", 50000, 65000], ["ANAK", "Anak (3–12 th)", 35000, 45000]]],
  ["DEMO-KERETA", "Wahana Kereta Mini", "Wahana", "single", false, 15000, 2000, "sekali-masuk",
    "Tiket wahana kereta mini keliling taman (1× naik).",
    [["UMUM", "Umum", 15000, 20000]]],
  ["DEMO-PAKET-KELUARGA", "Paket Keluarga (2 Dewasa + 2 Anak)", "Paket", "bundle", true, 150000, 20000, "bebas-keluar-masuk",
    "Hemat: 2 tiket dewasa + 2 tiket anak dalam satu paket.",
    [["PAKET", "Paket Keluarga", 150000, 190000]]],
  ["DEMO-PASS-TAHUNAN", "Season Pass Tahunan", "Tiket Masuk", "season_pass", true, 750000, 50000, "bebas-keluar-masuk",
    "Masuk sekali per hari selama 12 bulan, diskon member 10% untuk F&B.",
    [["TAHUNAN", "Tahunan (12 bulan)", 750000, 750000]]],
];

async function resolveVenue(c, scope) {
  const { rows } = await c.query(
    `SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`
  );
  const val = (k) => {
    const r = rows.find((x) => x.key === k);
    const v = r?.value;
    return typeof v === "string" ? v : v == null ? null : String(v).replace(/"/g, "");
  };
  let companyId = val("default_company_id");
  let branchId = val("default_branch_id");
  if (companyId && branchId) {
    const ok = await c.query(
      `SELECT b.name AS branch_name, co.name AS company_name FROM configuration.branches b
       JOIN configuration.companies co ON co.id = b.company_id
       WHERE b.id = $1 AND co.id = $2 AND b.is_active`,
      [branchId, companyId]
    );
    if (ok.rows[0]) return { companyId, branchId, ...ok.rows[0] };
  }
  companyId = scope.company_id;
  branchId = scope.branch_id;
  for (const [key, value] of [["default_company_id", companyId], ["default_branch_id", branchId]]) {
    await c.query(
      `INSERT INTO crm.crm_settings (key, value) VALUES ($1, to_jsonb($2::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }
  return { companyId, branchId, branch_name: scope.branch_name, company_name: scope.company_name };
}

async function activateMenus(c) {
  const { rowCount } = await c.query(
    `UPDATE iam.menus SET is_active = true, is_visible = true, deleted_at = NULL, updated_at = now()
     WHERE code = 'ticketing' OR code LIKE 'ticketing.%'`
  );
  await c.query(
    `INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
     SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
     FROM iam.roles r CROSS JOIN iam.menus m
     WHERE r.code = ANY($1::text[]) AND (m.code = 'ticketing' OR m.code LIKE 'ticketing.%')
     ON CONFLICT (role_id, menu_id) DO UPDATE SET
       is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now()`,
    [MENU_ROLES]
  );
  return rowCount;
}

async function clearDemo(c, v) {
  const b = [v.branchId];
  await c.query(`DELETE FROM ticketing.ticket_pass_entries WHERE season_pass_id IN (SELECT id FROM ticketing.ticket_season_passes WHERE branch_id = $1 AND pass_code LIKE 'SP-DEMO%')`, b);
  await c.query(`DELETE FROM ticketing.ticket_season_passes WHERE branch_id = $1 AND pass_code LIKE 'SP-DEMO%'`, b);
  await c.query(`DELETE FROM ticketing.ticket_visit_charges WHERE visit_id IN (SELECT id FROM ticketing.ticket_visits WHERE branch_id = $1 AND notes = 'seed_ticketing_demo')`, b);
  await c.query(`DELETE FROM ticketing.ticket_gate_events WHERE branch_id = $1 AND band_uid LIKE 'DEMO-BAND-%'`, b);
  await c.query(`DELETE FROM ticketing.ticket_visit_bands WHERE visit_id IN (SELECT id FROM ticketing.ticket_visits WHERE branch_id = $1 AND notes = 'seed_ticketing_demo')`, b);
  await c.query(`UPDATE ticketing.ticket_bookings SET visit_id = NULL WHERE branch_id = $1 AND booking_code LIKE 'BK-DEMO%'`, b);
  await c.query(`DELETE FROM ticketing.ticket_visits WHERE branch_id = $1 AND notes = 'seed_ticketing_demo'`, b);
  await c.query(`DELETE FROM ticketing.ticket_booking_guests WHERE booking_id IN (SELECT id FROM ticketing.ticket_bookings WHERE branch_id = $1 AND booking_code LIKE 'BK-DEMO%')`, b);
  await c.query(`DELETE FROM ticketing.ticket_booking_items WHERE booking_id IN (SELECT id FROM ticketing.ticket_bookings WHERE branch_id = $1 AND booking_code LIKE 'BK-DEMO%')`, b);
  await c.query(`DELETE FROM ticketing.ticket_bookings WHERE branch_id = $1 AND booking_code LIKE 'BK-DEMO%'`, b);
  await c.query(`DELETE FROM ticketing.ticket_staff_passes WHERE band_id IN (SELECT id FROM ticketing.ticket_bands WHERE branch_id = $1 AND nfc_uid LIKE 'DEMO-BAND-%')`, b);
  await c.query(`DELETE FROM ticketing.ticket_bands WHERE branch_id = $1 AND nfc_uid LIKE 'DEMO-BAND-%'`, b);
  const prod = `SELECT id FROM ticketing.ticket_products WHERE branch_id = $1 AND code LIKE 'DEMO-%'`;
  await c.query(`DELETE FROM ticketing.ticket_bundle_items WHERE bundle_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_variant_channel_prices WHERE variant_id IN (SELECT id FROM ticketing.ticket_product_variants WHERE ticket_product_id IN (${prod}))`, b);
  await c.query(`DELETE FROM ticketing.ticket_product_channels WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_product_dates WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_pass_configs WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_product_variants WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_products WHERE branch_id = $1 AND code LIKE 'DEMO-%'`, b);
  await c.query(`DELETE FROM ticketing.ticket_capacity_dates WHERE branch_id = $1 AND label LIKE 'DEMO %'`, b);
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL"); process.exit(1); }
  try { assertLocalTarget(url, "MIGRATE_DATABASE_URL"); } catch (err) { console.error(err.message); process.exit(1); }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await resolveSeedBusinessScope(c);
    const v = await resolveVenue(c, scope);
    console.log(`Venue ticketing: ${v.company_name} / ${v.branch_name}`);
    const { rows: adminRows } = await c.query(`SELECT id FROM configuration.users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1`);
    const uid = adminRows[0]?.id ?? null;
    const base = [v.companyId, v.branchId];

    const menus = await activateMenus(c);
    console.log(`✓ Menu Ticketing aktif: ${menus} menu, grant ke ${MENU_ROLES.join(", ")}`);

    // Settings venue
    await c.query(
      `INSERT INTO ticketing.ticket_settings
         (company_id, branch_id, re_entry_policy, default_credit_limit, default_payment_mode,
          booking_slug, booking_forfeit_days, daily_capacity, slot_grace_minutes, updated_by)
       VALUES ($1, $2, 'bebas-keluar-masuk', 500000, 'postpaid', 'sulu', 7, 800, 30, $3)
       ON CONFLICT (branch_id) DO UPDATE SET
         re_entry_policy = EXCLUDED.re_entry_policy, default_credit_limit = EXCLUDED.default_credit_limit,
         default_payment_mode = EXCLUDED.default_payment_mode,
         booking_slug = COALESCE(ticketing.ticket_settings.booking_slug, EXCLUDED.booking_slug),
         booking_forfeit_days = EXCLUDED.booking_forfeit_days, daily_capacity = EXCLUDED.daily_capacity,
         slot_grace_minutes = EXCLUDED.slot_grace_minutes, updated_at = now()`,
      [...base, uid]
    );
    console.log("✓ Pengaturan venue (re-entry bebas, kredit Rp 500.000, postpaid, slug booking 'sulu', kuota 800/hari)");

    await clearDemo(c, v);

    // Kanal & kategori
    const channelId = {};
    for (const [code, name, online, sort] of CHANNELS) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_channels (company_id, branch_id, code, name, is_online, sort_order, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         ON CONFLICT (branch_id, code) DO UPDATE SET name = EXCLUDED.name, is_online = EXCLUDED.is_online, is_active = true, updated_at = now()
         RETURNING id`,
        [...base, code, name, online, sort, uid]
      );
      channelId[code] = rows[0].id;
    }
    const categoryId = {};
    for (const name of CATEGORIES) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_categories (company_id, branch_id, name, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now() RETURNING id`,
        [...base, name, uid]
      );
      categoryId[name] = rows[0].id;
    }
    // Slot waktu & kuota tanggal
    const slotId = {};
    for (const [label, start, end, cap, sort] of TIME_SLOTS) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_time_slots (company_id, branch_id, label, start_time, end_time, capacity, sort_order, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
         ON CONFLICT (branch_id, label) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, capacity = EXCLUDED.capacity, is_active = true, updated_at = now()
         RETURNING id, label, start_time, end_time`,
        [...base, label, start, end, cap, sort, uid]
      );
      slotId[label] = rows[0];
    }
    const highFrom = `${new Date().getFullYear()}-12-24`, highTo = `${new Date().getFullYear() + 1}-01-04`;
    await c.query(
      `INSERT INTO ticketing.ticket_capacity_dates (company_id, branch_id, label, start_date, end_date, capacity, is_active, created_by)
       VALUES ($1, $2, 'DEMO Libur Akhir Tahun', $3, $4, 1200, true, $5)`,
      [...base, highFrom, highTo, uid]
    );
    console.log(`✓ Kanal ${CHANNELS.length}, kategori ${CATEGORIES.length}, slot ${TIME_SLOTS.length}, kuota libur akhir tahun`);

    // Produk tiket + varian + kanal + harga per kanal
    const product = {};
    const variant = {};
    for (const [code, name, cat, kind, gate, price, cogs, reentry, desc, variants] of PRODUCTS) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_products
           (company_id, branch_id, code, name, category_id, status, product_kind, base_price, cogs, has_gate, description, re_entry_policy, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [...base, code, name, categoryId[cat], kind, price, cogs, gate, desc, reentry, uid]
      );
      product[code] = rows[0].id;
      let sort = 0;
      for (const [vcode, vname, regular, high] of variants) {
        const { rows: vr } = await c.query(
          `INSERT INTO ticketing.ticket_product_variants (company_id, branch_id, ticket_product_id, code, name, price_regular, price_high, sort_order, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING id`,
          [...base, rows[0].id, vcode, vname, regular, high, (sort += 10)]
        );
        variant[`${code}:${vcode}`] = { id: vr[0].id, name: vname, regular, high, productName: name };
        for (const ch of Object.keys(channelId)) {
          const discount = ch === "website" && kind !== "season_pass" ? 5000 : 0;
          await c.query(
            `INSERT INTO ticketing.ticket_variant_channel_prices (company_id, branch_id, variant_id, channel_id, price_regular, price_high)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [...base, vr[0].id, channelId[ch], regular - discount, high - discount]
          );
        }
      }
      for (const ch of Object.keys(channelId)) {
        await c.query(
          `INSERT INTO ticketing.ticket_product_channels (company_id, branch_id, ticket_product_id, channel_id, is_distributed) VALUES ($1, $2, $3, $4, true)`,
          [...base, rows[0].id, channelId[ch]]
        );
      }
    }
    // High season & blok online untuk tiket masuk
    await c.query(
      `INSERT INTO ticketing.ticket_product_dates (company_id, branch_id, ticket_product_id, date_kind, label, start_date, end_date, is_active, created_by)
       VALUES ($1, $2, $3, 'high-season', 'Libur Akhir Tahun', $4, $5, true, $6),
              ($1, $2, $3, 'blok-online', 'Tutup booking online malam tahun baru', $7, $7, true, $6)`,
      [...base, product["DEMO-MASUK"], highFrom, highTo, uid, `${new Date().getFullYear()}-12-31`]
    );
    // Bundle: 2 dewasa + 2 anak
    for (const [vk, qty, sort] of [["DEMO-MASUK:DEWASA", 2, 10], ["DEMO-MASUK:ANAK", 2, 20]]) {
      await c.query(
        `INSERT INTO ticketing.ticket_bundle_items (company_id, branch_id, bundle_product_id, component_variant_id, qty, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
        [...base, product["DEMO-PAKET-KELUARGA"], variant[vk].id, qty, sort]
      );
    }
    // Season pass config
    await c.query(
      `INSERT INTO ticketing.ticket_pass_configs (company_id, branch_id, ticket_product_id, validity_months, entry_policy, visit_quota, is_active, member_discount_percent, created_by)
       VALUES ($1, $2, $3, 12, 'once_per_day', NULL, true, 10, $4)`,
      [...base, product["DEMO-PASS-TAHUNAN"], uid]
    );
    console.log(`✓ Produk tiket ${PRODUCTS.length} (reguler dewasa/anak, wahana, paket keluarga bundle, season pass) + harga per kanal + high season`);

    // Gelang NFC
    const bandId = {};
    for (let i = 1; i <= 24; i++) {
      const nfc = `DEMO-BAND-${String(i).padStart(4, "0")}`;
      const status = i <= 2 ? "karyawan" : "tersedia";
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_bands (company_id, branch_id, nfc_uid, label, status, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [...base, nfc, `Gelang #${i}`, status, uid]
      );
      bandId[i] = rows[0].id;
    }
    const { rows: emp } = await c.query(`SELECT id, full_name FROM hris.employees ORDER BY full_name LIMIT 2`);
    for (let i = 0; i < emp.length; i++) {
      await c.query(
        `INSERT INTO ticketing.ticket_staff_passes (company_id, branch_id, band_id, employee_id, is_active, created_by) VALUES ($1, $2, $3, $4, true, $5)`,
        [...base, bandId[i + 1], emp[i].id, uid]
      );
    }
    console.log(`✓ Gelang NFC 24 (2 gelang karyawan: ${emp.map((e) => e.full_name).join(", ") || "—"})`);

    // Booking online
    const slotPagi = slotId[TIME_SLOTS[0][0]], slotSiang = slotId[TIME_SLOTS[1][0]];
    const BOOKINGS = [
      { code: "BK-DEMO01", name: "Rina Kartika", phone: "628121110001", date: daysFromNow(1), status: "terbayar", slot: slotPagi, items: [["DEMO-MASUK:DEWASA", 2], ["DEMO-MASUK:ANAK", 1]], paid: -0.5 },
      { code: "BK-DEMO02", name: "Budi Santoso", phone: "628121110002", date: daysFromNow(-1), status: "digunakan", slot: slotSiang, items: [["DEMO-MASUK:DEWASA", 2], ["DEMO-KERETA:UMUM", 2]], paid: -2, used: -1 },
      { code: "BK-DEMO03", name: "Sari Dewi", phone: "628121110003", date: daysFromNow(3), status: "menunggu-bayar", slot: slotPagi, items: [["DEMO-MASUK:DEWASA", 1], ["DEMO-MASUK:ANAK", 2]], expires: 1 / 24 },
      { code: "BK-DEMO04", name: "Agus Prasetyo", phone: "628121110004", date: daysFromNow(-1), status: "kedaluwarsa", slot: slotSiang, items: [["DEMO-MASUK:DEWASA", 1]], expires: -1.5 },
      { code: "BK-DEMO05", name: "Maya Lestari", phone: "628121110005", date: daysFromNow(2), status: "dibatalkan", slot: slotPagi, items: [["DEMO-MASUK:DEWASA", 2]], paid: -1, refund: "Dibatalkan pelanggan, refund via transfer" },
      { code: "BK-DEMO06", name: "Keluarga Wijaya", phone: "628121110006", date: daysFromNow(7), status: "terbayar", slot: slotSiang, items: [["DEMO-PAKET-KELUARGA:PAKET", 1]], paid: -0.2, guests: ["Hendra Wijaya", "Lina Wijaya", "Kevin Wijaya", "Nadia Wijaya"] },
      { code: "BK-DEMO07", name: "Dedi Kurniawan", phone: "628121110007", date: daysFromNow(-3), status: "hangus", slot: slotPagi, items: [["DEMO-MASUK:DEWASA", 2], ["DEMO-MASUK:ANAK", 2]], paid: -5, forfeited: -2 },
      { code: "BK-DEMO08", name: "Putri Ayu", phone: "628121110008", date: daysFromNow(5), status: "terbayar", slot: slotPagi, items: [["DEMO-MASUK:DEWASA", 2]], paid: -0.1, promo: ["SULU10", 10000], gift: ["Ibu Ayu", "628121110009"] },
    ];
    const bookingId = {};
    for (const b of BOOKINGS) {
      const isHigh = false;
      const lines = b.items.map(([vk, qty]) => {
        const vr = variant[vk];
        const unit = vr.regular - (vk.startsWith("DEMO-PASS") ? 0 : 5000); // harga kanal website
        return { vr, vk, qty, unit, subtotal: unit * qty };
      });
      const discount = b.promo ? b.promo[1] : 0;
      const total = Math.max(0, lines.reduce((s, l) => s + l.subtotal, 0) - discount);
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_bookings
           (company_id, branch_id, booking_code, access_token, visit_date, customer_name, customer_phone, status, total,
            paid_at, expires_at, used_at, forfeited_at, refund_note, slot_id, slot_label, slot_start_time, slot_end_time,
            discount_amount, promo_code, gift_recipient_name, gift_recipient_phone, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         RETURNING id`,
        [...base, b.code, token(), ymd(b.date), b.name, b.phone, b.status, total,
         b.paid != null ? daysFromNow(b.paid) : null, b.expires != null ? daysFromNow(b.expires) : null,
         b.used != null ? daysFromNow(b.used) : null, b.forfeited != null ? daysFromNow(b.forfeited) : null,
         b.refund ?? null, b.slot.id, b.slot.label, b.slot.start_time, b.slot.end_time,
         discount, b.promo ? b.promo[0] : null, b.gift ? b.gift[0] : null, b.gift ? b.gift[1] : null,
         daysFromNow(Math.min(b.paid ?? 0, -0.6))]
      );
      bookingId[b.code] = rows[0].id;
      let pos = 0;
      for (const l of lines) {
        const { rows: it } = await c.query(
          `INSERT INTO ticketing.ticket_booking_items (company_id, branch_id, booking_id, ticket_product_id, variant_id, product_name, variant_name, qty, unit_price, season_kind, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [...base, rows[0].id, product[l.vk.split(":")[0]], l.vr.id, l.vr.productName, l.vr.name, l.qty, l.unit, isHigh ? "high" : "regular", l.subtotal]
        );
        const isBundle = l.vk.startsWith("DEMO-PAKET");
        const seats = isBundle ? 4 * l.qty : l.qty;
        for (let i = 0; i < seats; i++) {
          const guestName = b.guests?.[i] ?? (i === 0 ? b.name : `${b.name.split(" ")[0]} +${i}`);
          const compVariant = isBundle ? (i % 4 < 2 ? variant["DEMO-MASUK:DEWASA"] : variant["DEMO-MASUK:ANAK"]) : l.vr;
          await c.query(
            `INSERT INTO ticketing.ticket_booking_guests (company_id, branch_id, booking_id, booking_item_id, variant_id, guest_name, position, bundle_product_id, bundle_unit_no, allocated_price, member_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [...base, rows[0].id, it[0].id, compVariant.id, guestName, ++pos,
             isBundle ? product["DEMO-PAKET-KELUARGA"] : null, isBundle ? Math.floor(i / 4) + 1 : null,
             isBundle ? Math.round(l.unit / 4) : l.unit, isBundle ? (i % 4 < 2 ? "Dewasa" : "Anak") : null]
          );
        }
      }
    }
    console.log(`✓ Booking online ${BOOKINGS.length} (terbayar, digunakan, menunggu bayar, kedaluwarsa, dibatalkan, hangus, paket keluarga, promo+hadiah)`);

    // Kunjungan: 1 selesai (dari BK-DEMO02), 1 berjalan (walk-in hari ini)
    const mkVisit = async (spec) => {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_visits (company_id, branch_id, contact_name, contact_phone, channel_id, payment_mode, credit_limit, status, opened_at, settled_at, settled_by, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'seed_ticketing_demo', $12) RETURNING id`,
        [...base, spec.name, spec.phone, channelId[spec.channel], spec.mode, 500000, spec.status, spec.opened, spec.settled ?? null, spec.settled ? uid : null, uid]
      );
      const visitId = rows[0].id;
      for (const [bandNo, vk, guest, entered] of spec.bands) {
        const vr = variant[vk];
        await c.query(
          `INSERT INTO ticketing.ticket_visit_bands (company_id, branch_id, visit_id, band_id, entered_at, status, variant_id, guest_name, allocated_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [...base, visitId, bandId[bandNo], entered, spec.status === "settled" ? "selesai" : "aktif", vr.id, guest, vr.regular]
        );
        await c.query(`UPDATE ticketing.ticket_bands SET status = $2, updated_at = now() WHERE id = $1`, [bandId[bandNo], spec.status === "settled" ? "tersedia" : "dipakai"]);
        await c.query(
          `INSERT INTO ticketing.ticket_gate_events (company_id, branch_id, band_uid, band_id, visit_id, gate_label, result, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, 'Gate Utama', 'masuk', $6, $7)`,
          [...base, `DEMO-BAND-${String(bandNo).padStart(4, "0")}`, bandId[bandNo], visitId, uid, entered]
        );
      }
      for (const [type, dir, desc, amount, bandNo, at] of spec.charges) {
        await c.query(
          `INSERT INTO ticketing.ticket_visit_charges (company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, payment_method, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [...base, visitId, bandNo ? bandId[bandNo] : null, type, dir, desc, amount, type === "pembayaran" ? "cash" : null, uid, at]
        );
      }
      return visitId;
    };
    const yesterday = daysFromNow(-1);
    const v1 = await mkVisit({
      name: "Budi Santoso", phone: "628121110002", channel: "website", mode: "postpaid", status: "settled",
      opened: new Date(yesterday.getTime() - 5 * 3600000), settled: new Date(yesterday.getTime() - 1 * 3600000),
      bands: [[3, "DEMO-MASUK:DEWASA", "Budi Santoso", new Date(yesterday.getTime() - 5 * 3600000)], [4, "DEMO-MASUK:DEWASA", "Budi +1", new Date(yesterday.getTime() - 5 * 3600000)]],
      charges: [
        ["tiket", "debit", "Booking BK-DEMO02 — 2 Dewasa + 2 Kereta Mini", 120000, null, new Date(yesterday.getTime() - 5 * 3600000)],
        ["fnb", "debit", "Ramen Shoyu Ayam ×2, Es Kopi Susu ×2 (gelang #3)", 140000, 3, new Date(yesterday.getTime() - 3 * 3600000)],
        ["pembayaran", "kredit", "Pelunasan tab di loket", 260000, null, new Date(yesterday.getTime() - 1 * 3600000)],
      ],
    });
    await c.query(`UPDATE ticketing.ticket_bookings SET visit_id = $2 WHERE id = $1`, [bookingId["BK-DEMO02"], v1]);
    const now = new Date();
    await mkVisit({
      name: "Fajar Nugraha", phone: "628121110010", channel: "walk-in", mode: "postpaid", status: "open",
      opened: new Date(now.getTime() - 2 * 3600000),
      bands: [[5, "DEMO-MASUK:DEWASA", "Fajar Nugraha", new Date(now.getTime() - 2 * 3600000)], [6, "DEMO-MASUK:ANAK", "Raka (anak)", new Date(now.getTime() - 2 * 3600000)]],
      charges: [
        ["tiket", "debit", "Walk-in — 1 Dewasa + 1 Anak", 85000, null, new Date(now.getTime() - 2 * 3600000)],
        ["fnb", "debit", "Gyoza Ayam ×1, Iced Matcha Latte ×1 (gelang #5)", 58000, 5, new Date(now.getTime() - 1 * 3600000)],
      ],
    });
    console.log("✓ Kunjungan: 1 selesai (tab lunas, gelang dikembalikan), 1 berjalan (2 gelang dipakai, tab F&B terbuka)");

    // Season pass
    const passProduct = product["DEMO-PASS-TAHUNAN"];
    const PASSES = [
      { code: "SP-DEMO-0001", holder: "Andi Wirawan", phone: "628121120001", status: "active", from: daysFromNow(-40), band: 7, source: "loket", paid: -40, activated: -40, entries: [-30, -12, -1] },
      { code: "SP-DEMO-0002", holder: "Citra Maharani", phone: "628121120002", status: "pending", from: null, band: null, source: "online", paid: null, activated: null, entries: [], expiresPay: 1 },
      { code: "SP-DEMO-0003", holder: "Rudi Hartono", phone: "628121120003", status: "expired", from: daysFromNow(-400), band: null, source: "loket", paid: -400, activated: -400, entries: [-380, -200] },
    ];
    for (const p of PASSES) {
      const validFrom = p.from ? ymd(p.from) : null;
      const validUntil = p.from ? ymd(new Date(p.from.getTime() + 365 * 86400000)) : null;
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_season_passes
           (company_id, branch_id, ticket_product_id, pass_code, access_token, holder_name, holder_phone, valid_from, valid_until, status,
            entry_policy, band_id, band_uid, source, unit_price, payment_expires_at, paid_at, activated_at, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'once_per_day', $11, $12, $13, 750000, $14, $15, $16, 'seed_ticketing_demo', $17) RETURNING id`,
        [...base, passProduct, p.code, token(), p.holder, p.phone, validFrom, validUntil, p.status,
         p.band ? bandId[p.band] : null, p.band ? `DEMO-BAND-${String(p.band).padStart(4, "0")}` : null, p.source,
         p.expiresPay ? daysFromNow(p.expiresPay) : null, p.paid != null ? daysFromNow(p.paid) : null, p.activated != null ? daysFromNow(p.activated) : null, uid]
      );
      if (p.band) await c.query(`UPDATE ticketing.ticket_bands SET status = 'dipakai', updated_at = now() WHERE id = $1`, [bandId[p.band]]);
      for (const d of p.entries) {
        await c.query(
          `INSERT INTO ticketing.ticket_pass_entries (company_id, branch_id, season_pass_id, entry_date, entry_policy, gate_label, band_uid, result, created_by, created_at)
           VALUES ($1, $2, $3, $4, 'once_per_day', 'Gate Utama', $5, 'granted', $6, $7)`,
          [...base, rows[0].id, ymd(daysFromNow(d)), p.band ? `DEMO-BAND-${String(p.band).padStart(4, "0")}` : null, uid, daysFromNow(d)]
        );
      }
    }
    console.log(`✓ Season pass ${PASSES.length} (aktif dengan riwayat masuk, menunggu bayar online, kedaluwarsa)`);

    await c.query("COMMIT");
    console.log("\nSelesai. Buka Dashboard → Ticketing (Pengaturan, Master Ticket, Booking, Loket & Kasir, Mode Gate, Season Pass, Laporan).");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
