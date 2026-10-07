#!/usr/bin/env node
/**
 * Seeder TENANT DUSUN BAMBU — bagian 3: Ticketing & aktivitas
 * (data lokal, owner 2026-09-06).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal) untuk venue
 * Dusun Bambu Lembang:
 *   - ticket_settings, kanal (walk-in/website/OTA), kategori, slot waktu, kuota tanggal
 *   - ticket_products: tiket masuk dewasa/anak, Bandung Playground, wahana danau,
 *     sepeda listrik, berkuda, panahan, paket keluarga (bundle), season pass
 *   - harga per kanal + kalender high season
 *   - gelang NFC, booking online lintas status, kunjungan (tab F&B), season pass
 *
 * CATATAN VENUE: seeder TIDAK mengubah default venue CRM (tetap Sulu). Data
 * Dusun Bambu terlihat saat login sebagai user ber-scope cabang Dusun Bambu
 * (demo@dusunbambu.id dari bagian 1).
 *
 * Prasyarat: npm run db:seed:dusun-bambu
 * Usage:     npm run db:seed:dusun-bambu-ticketing
 */

const crypto = require("crypto");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { loadEnv, ensureScope } = require("./lib/dusun-bambu-scope");

const MENU_ROLES = ["super_admin", "admin"];
const ymd = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000);
const token = () => crypto.randomBytes(32).toString("hex");

const CHANNELS = [
  ["walk-in", "Loket Dusun Bambu", false, 10],
  ["website", "Website dusunbambu.id", true, 20],
  ["ota", "OTA (Traveloka / tiket.com)", true, 30],
];
const CATEGORIES = ["Tiket Masuk", "Wahana & Aktivitas", "Paket"];
const TIME_SLOTS = [
  ["Sesi Pagi (08.00–12.00)", "08:00", "12:00", 800, 10],
  ["Sesi Siang (12.00–16.00)", "12:00", "16:00", 800, 20],
  ["Sesi Sore (16.00–20.00)", "16:00", "20:00", 500, 30],
];

// [code, name, kategori, kind, has_gate, base, cogs, re_entry, deskripsi, variants[[code,name,regular,high]]]
const PRODUCTS = [
  ["DB-MASUK", "Tiket Masuk Dusun Bambu", "Tiket Masuk", "single", true, 35_000, 4_000, "bebas-keluar-masuk",
    "Akses kawasan 15 ha: taman bunga, danau Purbasari, area piknik. Berlaku 1 hari.",
    [["DEWASA", "Dewasa", 35_000, 45_000], ["ANAK", "Anak (3–12 th)", 25_000, 35_000]]],
  ["DB-PLAYGROUND", "Bandung Playground", "Wahana & Aktivitas", "single", false, 50_000, 8_000, "sekali-masuk",
    "Playground anak: adrenaline games, spot foto, wahana interaktif.",
    [["UMUM", "Umum", 50_000, 65_000]]],
  ["DB-DANAU", "Wahana Danau (Sampan / Bebek Air)", "Wahana & Aktivitas", "single", false, 30_000, 5_000, "sekali-masuk",
    "Berkeliling danau Purbasari dengan sampan atau bebek air, 20 menit.",
    [["SAMPAN", "Sampan", 30_000, 35_000], ["BEBEK", "Bebek Air", 35_000, 45_000]]],
  ["DB-SEPEDA", "Sewa Sepeda Listrik (1 jam)", "Wahana & Aktivitas", "single", false, 75_000, 10_000, "sekali-masuk",
    "Menjelajah kawasan dengan sepeda listrik, termasuk helm.",
    [["UMUM", "Umum", 75_000, 90_000]]],
  ["DB-KUDA", "Berkuda Keliling Taman", "Wahana & Aktivitas", "single", false, 50_000, 12_000, "sekali-masuk",
    "Menunggang kuda didampingi pawang, 1 putaran taman.",
    [["UMUM", "Umum", 50_000, 60_000]]],
  ["DB-PANAHAN", "Panahan (10 anak panah)", "Wahana & Aktivitas", "single", false, 40_000, 6_000, "sekali-masuk",
    "Sesi panahan dengan instruktur, 10 anak panah.",
    [["UMUM", "Umum", 40_000, 50_000]]],
  ["DB-PAKET-KELUARGA", "Paket Keluarga (2 Dewasa + 2 Anak + Playground)", "Paket", "bundle", true, 220_000, 30_000, "bebas-keluar-masuk",
    "Hemat: tiket masuk 4 orang + tiket Bandung Playground untuk 2 anak.",
    [["PAKET", "Paket Keluarga", 220_000, 280_000]]],
  ["DB-PASS", "Dusun Pass Tahunan", "Tiket Masuk", "season_pass", true, 500_000, 40_000, "bebas-keluar-masuk",
    "Masuk sekali sehari selama 12 bulan + diskon 10% F&B dan resort.",
    [["TAHUNAN", "Tahunan (12 bulan)", 500_000, 500_000]]],
];

async function activateMenus(c) {
  await c.query(
    `UPDATE iam.menus SET is_active = true, is_visible = true, deleted_at = NULL, updated_at = now()
     WHERE code = 'ticketing' OR code LIKE 'ticketing.%'`
  );
  await c.query(
    `INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
     SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
     FROM iam.roles r CROSS JOIN iam.menus m
     WHERE r.code = ANY($1::text[]) AND (m.code = 'ticketing' OR m.code LIKE 'ticketing.%')
     ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now()`,
    [MENU_ROLES]
  );
}

async function clearDemo(c, branchId) {
  const b = [branchId];
  await c.query(`DELETE FROM ticketing.ticket_pass_entries WHERE season_pass_id IN (SELECT id FROM ticketing.ticket_season_passes WHERE branch_id = $1)`, b);
  await c.query(`DELETE FROM ticketing.ticket_season_passes WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_visit_charges WHERE visit_id IN (SELECT id FROM ticketing.ticket_visits WHERE branch_id = $1)`, b);
  await c.query(`DELETE FROM ticketing.ticket_gate_events WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_visit_bands WHERE visit_id IN (SELECT id FROM ticketing.ticket_visits WHERE branch_id = $1)`, b);
  await c.query(`UPDATE ticketing.ticket_bookings SET visit_id = NULL WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_visits WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_booking_guests WHERE booking_id IN (SELECT id FROM ticketing.ticket_bookings WHERE branch_id = $1)`, b);
  await c.query(`DELETE FROM ticketing.ticket_booking_items WHERE booking_id IN (SELECT id FROM ticketing.ticket_bookings WHERE branch_id = $1)`, b);
  await c.query(`DELETE FROM ticketing.ticket_bookings WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_staff_passes WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_bands WHERE branch_id = $1`, b);
  const prod = `SELECT id FROM ticketing.ticket_products WHERE branch_id = $1`;
  await c.query(`DELETE FROM ticketing.ticket_bundle_items WHERE bundle_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_variant_channel_prices WHERE variant_id IN (SELECT id FROM ticketing.ticket_product_variants WHERE ticket_product_id IN (${prod}))`, b);
  await c.query(`DELETE FROM ticketing.ticket_product_channels WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_product_dates WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_pass_configs WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_product_variants WHERE ticket_product_id IN (${prod})`, b);
  await c.query(`DELETE FROM ticketing.ticket_products WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_capacity_dates WHERE branch_id = $1`, b);
  await c.query(`DELETE FROM ticketing.ticket_time_slots WHERE branch_id = $1`, b);
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
    const scope = await ensureScope(c);
    const base = [scope.company_id, scope.branch_id];
    console.log(`Venue ticketing: ${scope.company_name} / ${scope.branch_name}`);

    const demo = await c.query(`SELECT id FROM configuration.users WHERE branch_id = $1 ORDER BY created_at LIMIT 1`, [scope.branch_id]);
    const superAdmin = await c.query(`SELECT id FROM configuration.users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1`);
    const uid = demo.rows[0]?.id ?? superAdmin.rows[0]?.id ?? null;

    await activateMenus(c);
    console.log("✓ Menu Ticketing aktif untuk super_admin & admin");

    await c.query(
      `INSERT INTO ticketing.ticket_settings
         (company_id, branch_id, re_entry_policy, default_credit_limit, default_payment_mode, booking_slug, booking_forfeit_days, daily_capacity, slot_grace_minutes, updated_by)
       VALUES ($1,$2,'bebas-keluar-masuk',750000,'postpaid','dusun-bambu',7,2500,30,$3)
       ON CONFLICT (branch_id) DO UPDATE SET
         re_entry_policy = EXCLUDED.re_entry_policy, default_credit_limit = EXCLUDED.default_credit_limit,
         default_payment_mode = EXCLUDED.default_payment_mode,
         booking_slug = COALESCE(ticketing.ticket_settings.booking_slug, EXCLUDED.booking_slug),
         booking_forfeit_days = EXCLUDED.booking_forfeit_days, daily_capacity = EXCLUDED.daily_capacity, updated_at = now()`,
      [...base, uid]
    );
    console.log("✓ Pengaturan venue (kuota 2.500 orang/hari, re-entry bebas, slug booking 'dusun-bambu')");

    await clearDemo(c, scope.branch_id);

    const channelId = {};
    for (const [code, name, online, sort] of CHANNELS) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_channels (company_id, branch_id, code, name, is_online, sort_order, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7)
         ON CONFLICT (branch_id, code) DO UPDATE SET name = EXCLUDED.name, is_online = EXCLUDED.is_online, is_active = true, updated_at = now()
         RETURNING id`,
        [...base, code, name, online, sort, uid]
      );
      channelId[code] = rows[0].id;
    }
    const categoryId = {};
    for (const name of CATEGORIES) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_categories (company_id, branch_id, name, created_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now() RETURNING id`,
        [...base, name, uid]
      );
      categoryId[name] = rows[0].id;
    }
    const slots = {};
    for (const [label, start, end, cap, sort] of TIME_SLOTS) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_time_slots (company_id, branch_id, label, start_time, end_time, capacity, sort_order, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
         ON CONFLICT (branch_id, label) DO UPDATE SET capacity = EXCLUDED.capacity, is_active = true, updated_at = now()
         RETURNING id, label, start_time, end_time`,
        [...base, label, start, end, cap, sort, uid]
      );
      slots[label] = rows[0];
    }
    const year = new Date().getFullYear();
    await c.query(
      `INSERT INTO ticketing.ticket_capacity_dates (company_id, branch_id, label, start_date, end_date, capacity, is_active, created_by)
       VALUES ($1,$2,'Libur Akhir Tahun',$3,$4,3500,true,$5),
              ($1,$2,'Libur Sekolah',$6,$7,3000,true,$5)`,
      [...base, `${year}-12-24`, `${year + 1}-01-04`, uid, `${year}-06-20`, `${year}-07-10`]
    );
    console.log(`✓ Kanal ${CHANNELS.length}, kategori ${CATEGORIES.length}, slot ${TIME_SLOTS.length}, 2 kuota musim`);

    const product = {}, variant = {};
    for (const [code, name, cat, kind, gate, price, cogs, reentry, desc, variants] of PRODUCTS) {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_products
           (company_id, branch_id, code, name, category_id, status, product_kind, base_price, cogs, has_gate, description, re_entry_policy, created_by)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [...base, code, name, categoryId[cat], kind, price, cogs, gate, desc, reentry, uid]
      );
      product[code] = rows[0].id;
      let sort = 0;
      for (const [vcode, vname, regular, high] of variants) {
        const { rows: vr } = await c.query(
          `INSERT INTO ticketing.ticket_product_variants (company_id, branch_id, ticket_product_id, code, name, price_regular, price_high, sort_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
          [...base, rows[0].id, vcode, vname, regular, high, (sort += 10)]
        );
        variant[`${code}:${vcode}`] = { id: vr[0].id, name: vname, regular, high, productName: name };
        for (const ch of Object.keys(channelId)) {
          // Website diskon Rp 5.000, OTA harga penuh (komisi dipotong di sisi OTA)
          const price = ch === "website" && kind !== "season_pass" ? regular - 5_000 : regular;
          const priceHigh = ch === "website" && kind !== "season_pass" ? high - 5_000 : high;
          await c.query(
            `INSERT INTO ticketing.ticket_variant_channel_prices (company_id, branch_id, variant_id, channel_id, price_regular, price_high)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [...base, vr[0].id, channelId[ch], price, priceHigh]
          );
        }
      }
      for (const ch of Object.keys(channelId)) {
        await c.query(
          `INSERT INTO ticketing.ticket_product_channels (company_id, branch_id, ticket_product_id, channel_id, is_distributed) VALUES ($1,$2,$3,$4,true)`,
          [...base, rows[0].id, channelId[ch]]
        );
      }
    }
    await c.query(
      `INSERT INTO ticketing.ticket_product_dates (company_id, branch_id, ticket_product_id, date_kind, label, start_date, end_date, is_active, created_by)
       VALUES ($1,$2,$3,'high-season','Libur Akhir Tahun',$4,$5,true,$6),
              ($1,$2,$3,'high-season','Libur Sekolah',$7,$8,true,$6)`,
      [...base, product["DB-MASUK"], `${year}-12-24`, `${year + 1}-01-04`, uid, `${year}-06-20`, `${year}-07-10`]
    );
    for (const [vk, qty, sort] of [["DB-MASUK:DEWASA", 2, 10], ["DB-MASUK:ANAK", 2, 20], ["DB-PLAYGROUND:UMUM", 2, 30]]) {
      await c.query(
        `INSERT INTO ticketing.ticket_bundle_items (company_id, branch_id, bundle_product_id, component_variant_id, qty, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [...base, product["DB-PAKET-KELUARGA"], variant[vk].id, qty, sort]
      );
    }
    await c.query(
      `INSERT INTO ticketing.ticket_pass_configs (company_id, branch_id, ticket_product_id, validity_months, entry_policy, is_active, member_discount_percent, created_by)
       VALUES ($1,$2,$3,12,'once_per_day',true,10,$4)`,
      [...base, product["DB-PASS"], uid]
    );
    console.log(`✓ Produk tiket ${PRODUCTS.length} (masuk, playground, danau, sepeda, berkuda, panahan, paket keluarga, pass tahunan)`);

    // Gelang NFC
    const bandId = {};
    for (let i = 1; i <= 30; i += 1) {
      const nfc = `DB-BAND-${String(i).padStart(4, "0")}`;
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_bands (company_id, branch_id, nfc_uid, label, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [...base, nfc, `Gelang Dusun #${i}`, i <= 2 ? "karyawan" : "tersedia", uid]
      );
      bandId[i] = rows[0].id;
    }
    console.log("✓ Gelang NFC 30 (2 gelang karyawan)");

    // Booking online
    const pagi = slots[TIME_SLOTS[0][0]], siang = slots[TIME_SLOTS[1][0]];
    const BOOKINGS = [
      { code: "BK-DB0001", name: "Keluarga Nugroho", phone: "628131110001", date: daysFromNow(1), status: "terbayar", slot: pagi, items: [["DB-PAKET-KELUARGA:PAKET", 1]], paid: -0.5, guests: ["Andi Nugroho", "Sari Nugroho", "Alya", "Bima"] },
      { code: "BK-DB0002", name: "Ratna Kusuma", phone: "628131110002", date: daysFromNow(-1), status: "digunakan", slot: siang, items: [["DB-MASUK:DEWASA", 2], ["DB-DANAU:SAMPAN", 2]], paid: -2, used: -1 },
      { code: "BK-DB0003", name: "SD Cendekia (rombongan)", phone: "628131110003", date: daysFromNow(4), status: "terbayar", slot: pagi, items: [["DB-MASUK:ANAK", 40], ["DB-PLAYGROUND:UMUM", 40]], paid: -1 },
      { code: "BK-DB0004", name: "Yoga Pratama", phone: "628131110004", date: daysFromNow(3), status: "menunggu-bayar", slot: siang, items: [["DB-MASUK:DEWASA", 2], ["DB-SEPEDA:UMUM", 2]], expires: 1 / 24 },
      { code: "BK-DB0005", name: "Dewi Anggraini", phone: "628131110005", date: daysFromNow(-2), status: "kedaluwarsa", slot: pagi, items: [["DB-MASUK:DEWASA", 2]], expires: -2.5 },
      { code: "BK-DB0006", name: "Rizky Maulana", phone: "628131110006", date: daysFromNow(2), status: "dibatalkan", slot: siang, items: [["DB-MASUK:DEWASA", 3]], paid: -3, refund: "Dibatalkan tamu, refund transfer" },
    ];
    const bookingId = {};
    for (const b of BOOKINGS) {
      const lines = b.items.map(([vk, qty]) => {
        const vr = variant[vk];
        const unit = vr.regular - (vk.startsWith("DB-PASS") ? 0 : 5_000);
        return { vr, vk, qty, unit, subtotal: unit * qty };
      });
      const total = lines.reduce((s, l) => s + l.subtotal, 0);
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_bookings
           (company_id, branch_id, booking_code, access_token, visit_date, customer_name, customer_phone, status, total,
            paid_at, expires_at, used_at, refund_note, slot_id, slot_label, slot_start_time, slot_end_time, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [...base, b.code, token(), ymd(b.date), b.name, b.phone, b.status, total,
         b.paid != null ? daysFromNow(b.paid) : null, b.expires != null ? daysFromNow(b.expires) : null,
         b.used != null ? daysFromNow(b.used) : null, b.refund ?? null,
         b.slot.id, b.slot.label, b.slot.start_time, b.slot.end_time, daysFromNow(Math.min(b.paid ?? 0, -0.6))]
      );
      bookingId[b.code] = rows[0].id;
      let pos = 0;
      for (const l of lines) {
        const { rows: it } = await c.query(
          `INSERT INTO ticketing.ticket_booking_items (company_id, branch_id, booking_id, ticket_product_id, variant_id, product_name, variant_name, qty, unit_price, season_kind, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'regular',$10) RETURNING id`,
          [...base, rows[0].id, product[l.vk.split(":")[0]], l.vr.id, l.vr.productName, l.vr.name, l.qty, l.unit, l.subtotal]
        );
        const isBundle = l.vk.startsWith("DB-PAKET");
        const seats = Math.min(isBundle ? 4 * l.qty : l.qty, 12); // batasi nama tamu untuk rombongan besar
        for (let i = 0; i < seats; i += 1) {
          const compVariant = isBundle ? (i % 4 < 2 ? variant["DB-MASUK:DEWASA"] : variant["DB-MASUK:ANAK"]) : l.vr;
          await c.query(
            `INSERT INTO ticketing.ticket_booking_guests (company_id, branch_id, booking_id, booking_item_id, variant_id, guest_name, position, bundle_product_id, bundle_unit_no, allocated_price, member_label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [...base, rows[0].id, it[0].id, compVariant.id, b.guests?.[i] ?? `${b.name.split(" ")[0]} ${i + 1}`, ++pos,
             isBundle ? product["DB-PAKET-KELUARGA"] : null, isBundle ? Math.floor(i / 4) + 1 : null,
             isBundle ? Math.round(l.unit / 4) : l.unit, isBundle ? (i % 4 < 2 ? "Dewasa" : "Anak") : null]
          );
        }
      }
    }
    console.log(`✓ Booking online ${BOOKINGS.length} (paket keluarga, rombongan sekolah, wahana, berbagai status)`);

    // Kunjungan: 1 selesai, 1 berjalan (tab F&B ke gelang)
    const mkVisit = async (spec) => {
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_visits (company_id, branch_id, contact_name, contact_phone, channel_id, payment_mode, credit_limit, status, opened_at, settled_at, settled_by, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,'postpaid',750000,$6,$7,$8,$9,'seed_dusun_bambu',$10) RETURNING id`,
        [...base, spec.name, spec.phone, channelId[spec.channel], spec.status, spec.opened, spec.settled ?? null, spec.settled ? uid : null, uid]
      );
      const visitId = rows[0].id;
      for (const [bandNo, vk, guest] of spec.bands) {
        const vr = variant[vk];
        await c.query(
          `INSERT INTO ticketing.ticket_visit_bands (company_id, branch_id, visit_id, band_id, entered_at, status, variant_id, guest_name, allocated_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [...base, visitId, bandId[bandNo], spec.opened, spec.status === "settled" ? "selesai" : "aktif", vr.id, guest, vr.regular]
        );
        await c.query(`UPDATE ticketing.ticket_bands SET status = $2, updated_at = now() WHERE id = $1`,
          [bandId[bandNo], spec.status === "settled" ? "tersedia" : "dipakai"]);
        await c.query(
          `INSERT INTO ticketing.ticket_gate_events (company_id, branch_id, band_uid, band_id, visit_id, gate_label, result, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,'Gate Utama','masuk',$6,$7)`,
          [...base, `DB-BAND-${String(bandNo).padStart(4, "0")}`, bandId[bandNo], visitId, uid, spec.opened]
        );
      }
      for (const [type, dir, desc, amount, bandNo, at] of spec.charges) {
        await c.query(
          `INSERT INTO ticketing.ticket_visit_charges (company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, payment_method, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [...base, visitId, bandNo ? bandId[bandNo] : null, type, dir, desc, amount, type === "pembayaran" ? "cash" : null, uid, at]
        );
      }
      return visitId;
    };
    const yesterday = daysFromNow(-1), now = new Date();
    const v1 = await mkVisit({
      name: "Ratna Kusuma", phone: "628131110002", channel: "website", status: "settled",
      opened: new Date(yesterday.getTime() - 6 * 3_600_000), settled: new Date(yesterday.getTime() - 2 * 3_600_000),
      bands: [[3, "DB-MASUK:DEWASA", "Ratna Kusuma"], [4, "DB-MASUK:DEWASA", "Ratna +1"]],
      charges: [
        ["tiket", "debit", "Booking BK-DB0002 — 2 dewasa + 2 sampan", 120_000, null, new Date(yesterday.getTime() - 6 * 3_600_000)],
        ["fnb", "debit", "Nasi Liwet Komplit + Bandrek (Purbasari)", 201_000, 3, new Date(yesterday.getTime() - 4 * 3_600_000)],
        ["pembayaran", "kredit", "Pelunasan tab di loket", 321_000, null, new Date(yesterday.getTime() - 2 * 3_600_000)],
      ],
    });
    await c.query(`UPDATE ticketing.ticket_bookings SET visit_id = $2 WHERE id = $1`, [bookingId["BK-DB0002"], v1]);
    await mkVisit({
      name: "Fajar & Keluarga", phone: "628131110010", channel: "walk-in", status: "open",
      opened: new Date(now.getTime() - 3 * 3_600_000),
      bands: [[5, "DB-MASUK:DEWASA", "Fajar"], [6, "DB-MASUK:DEWASA", "Nia"], [7, "DB-MASUK:ANAK", "Kayla"]],
      charges: [
        ["tiket", "debit", "Walk-in — 2 dewasa + 1 anak", 95_000, null, new Date(now.getTime() - 3 * 3_600_000)],
        ["tiket", "debit", "Aktivitas: berkuda 1 putaran + panahan", 90_000, 5, new Date(now.getTime() - 2 * 3_600_000)],
        ["fnb", "debit", "Besek Piknik Sunda (Lutung Kasarung)", 235_000, 5, new Date(now.getTime() - 1 * 3_600_000)],
      ],
    });
    console.log("✓ Kunjungan: 1 selesai (tab lunas), 1 berjalan (tiket + aktivitas + F&B di gelang)");

    // Season pass
    const PASSES = [
      { code: "SP-DB-0001", holder: "Yudi Hermawan", phone: "628131120001", status: "active", from: daysFromNow(-60), band: 8, source: "loket", entries: [-45, -20, -5] },
      { code: "SP-DB-0002", holder: "Melati Sari", phone: "628131120002", status: "pending", from: null, band: null, source: "online", entries: [] },
    ];
    for (const p of PASSES) {
      const validFrom = p.from ? ymd(p.from) : null;
      const validUntil = p.from ? ymd(new Date(p.from.getTime() + 365 * 86_400_000)) : null;
      const { rows } = await c.query(
        `INSERT INTO ticketing.ticket_season_passes
           (company_id, branch_id, ticket_product_id, pass_code, access_token, holder_name, holder_phone, valid_from, valid_until,
            status, entry_policy, band_id, band_uid, source, unit_price, payment_expires_at, paid_at, activated_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'once_per_day',$11,$12,$13,500000,$14,$15,$16,'seed_dusun_bambu',$17) RETURNING id`,
        [...base, product["DB-PASS"], p.code, token(), p.holder, p.phone, validFrom, validUntil, p.status,
         p.band ? bandId[p.band] : null, p.band ? `DB-BAND-${String(p.band).padStart(4, "0")}` : null, p.source,
         p.status === "pending" ? daysFromNow(1) : null, p.from ? p.from : null, p.from ? p.from : null, uid]
      );
      if (p.band) await c.query(`UPDATE ticketing.ticket_bands SET status = 'dipakai' WHERE id = $1`, [bandId[p.band]]);
      for (const d of p.entries) {
        await c.query(
          `INSERT INTO ticketing.ticket_pass_entries (company_id, branch_id, season_pass_id, entry_date, entry_policy, gate_label, band_uid, result, created_by, created_at)
           VALUES ($1,$2,$3,$4,'once_per_day','Gate Utama',$5,'granted',$6,$7)`,
          [...base, rows[0].id, ymd(daysFromNow(d)), p.band ? `DB-BAND-${String(p.band).padStart(4, "0")}` : null, uid, daysFromNow(d)]
        );
      }
    }
    console.log(`✓ Dusun Pass ${PASSES.length} (aktif dengan riwayat masuk, menunggu bayar)`);

    await c.query("COMMIT");
    console.log("\nSelesai bagian 3. Login demo@dusunbambu.id untuk melihat Ticketing & Resort Dusun Bambu.");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
