/**
 * Generator data demo modul RESORT (owner 2026-09-06) — dipakai lintas venue.
 *
 * Modul Resort membaca venue dari scope bisnis user (fallback default venue di
 * CRM Settings). Karena itu data demo harus dibuat PER CABANG: satu untuk
 * cabang yang dilihat super admin, satu lagi untuk tenant Dusun Bambu.
 * Semua logika pembangkitan ada di sini supaya kedua seeder tidak menyalin
 * kode yang sama.
 *
 * Deterministik: memakai RNG ber-seed, jadi menjalankan ulang menghasilkan
 * data yang sama. Data resort cabang target dihapus lebih dulu.
 */

const crypto = require("crypto");

const token = () => crypto.randomBytes(24).toString("hex");
const ymd = (d) => d.toISOString().slice(0, 10);

function todayParts() {
  const now = new Date(Date.now() + 7 * 3_600_000); // WIB
  return [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
}
const dayFrom = (n) => new Date(Date.UTC(...todayParts()) + n * 86_400_000);

/** RNG deterministik (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GUESTS = [
  ["Hendra Wijaya", "628121230101"], ["Sinta Nuriyah", "628121230102"], ["Bagus Setiawan", "628121230103"],
  ["Rina Kartika", "628121230104"], ["Dimas Prasetyo", "628121230105"], ["Ayu Lestari", "628121230106"],
  ["Fajar Nugraha", "628121230107"], ["Maya Anggraini", "628121230108"], ["Reza Firmansyah", "628121230109"],
  ["Dewi Kusuma", "628121230110"], ["Andi Saputra", "628121230111"], ["Nadia Rahmawati", "628121230112"],
  ["Yoga Pratama", "628121230113"], ["Citra Melati", "628121230114"], ["Bayu Ramadhan", "628121230115"],
  ["Sari Wulandari", "628121230116"], ["Iwan Kurniawan", "628121230117"], ["Putri Handayani", "628121230118"],
  ["Rudi Hartono", "628121230119"], ["Lina Marlina", "628121230120"], ["Gilang Permana", "628121230121"],
  ["Tari Oktaviani", "628121230122"], ["Hafiz Ramadhan", "628121230123"], ["Vina Salsabila", "628121230124"],
  ["Eko Prabowo", "628121230125"], ["Mira Susanti", "628121230126"], ["Doni Alamsyah", "628121230127"],
  ["Kirana Dewanti", "628121230128"], ["Arif Budiman", "628121230129"], ["Wulan Sari", "628121230130"],
];
const CORPORATE = [
  ["PT Aksara Nusantara", "628121230201"], ["Yayasan Cendekia Bangsa", "628121230202"],
  ["PT Sinar Rejeki Abadi", "628121230203"], ["Komunitas Fotografi Bandung", "628121230204"],
];
const SOURCES = ["walk-in", "website", "ota", "telepon", "korporat"];
const DEFAULT_FNB = [
  ["Makan malam di restoran", 480_000], ["Sarapan 2 orang", 220_000], ["Paket piknik", 470_000],
  ["Minuman hangat di kamar", 116_000], ["Steak & pasta", 273_000], ["Makan malam keluarga", 194_000],
];
const DEFAULT_ACTIVITIES = [
  ["Sewa sepeda listrik 2 jam", 150_000], ["Berkuda keliling taman (2 orang)", 100_000],
  ["Tiket playground (2 anak)", 100_000], ["Wahana danau — sampan (4 orang)", 120_000],
  ["Sesi panahan keluarga", 160_000],
];
const REQUESTS = [
  "Minta kamar berdekatan", "Tamu ulang tahun, siapkan kue", "Datang larut malam ±22.00",
  "Alergi seafood", "Butuh extra handuk",
];

function isWeekendNight(dateStr) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6; // malam Jumat & Sabtu
}

function nightlyRate(type, dateStr, seasonList) {
  const base = isWeekendNight(dateStr) ? type.rate_weekend : type.rate_weekday;
  const match = seasonList
    .filter((s) => (!s.type || s.type === type.code) && dateStr >= s.start && dateStr <= s.end)
    .sort((a, b) => (a.type ? 0 : 1) - (b.type ? 0 : 1))[0];
  let rate = base;
  if (match) {
    if (match.rate != null) rate = match.rate;
    else if (match.surcharge != null) rate = base * (1 + match.surcharge / 100);
  }
  return { date: dateStr, rate: Math.round(rate), weekend: isWeekendNight(dateStr), season: match?.label ?? null };
}

/**
 * @param {object} c            klien pg (di dalam transaksi)
 * @param {object} opts
 * @param {object} opts.scope   { company_id, branch_id }
 * @param {Array}  opts.roomTypes  [code, nama, zona, dewasa, anak, extraBedMax, weekday, weekend, extraBedRate, fasilitas[], unit]
 * @param {Array}  opts.seasons   [{ label, start, end, surcharge?|rate?, type? }]
 * @param {string} opts.codePrefix  contoh "RSV-DB" (kode jadi RSV-DB0001)
 * @param {number} opts.seed
 * @param {object} [opts.counts]  { past, inHouse, upcoming, pending, cancelled, noShow }
 * @param {Array}  [opts.fnbItems] / [opts.activities]
 */
async function seedResortDemo(c, opts) {
  const {
    scope, roomTypes, seasons, codePrefix, seed = 20260906,
    counts = { past: 25, inHouse: 8, upcoming: 6, pending: 3, cancelled: 2, noShow: 1 },
    fnbItems = DEFAULT_FNB, activities = DEFAULT_ACTIVITIES,
    log = () => {},
  } = opts;
  const base = [scope.company_id, scope.branch_id];

  const actor = await c.query(
    `SELECT id, full_name FROM configuration.users WHERE branch_id = $1 ORDER BY created_at LIMIT 1`,
    [scope.branch_id]
  );
  const fallback = await c.query(
    `SELECT id, full_name FROM configuration.users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1`
  );
  const userId = actor.rows[0]?.id ?? fallback.rows[0]?.id ?? null;
  const userName = actor.rows[0]?.full_name ?? "Front Office";

  await c.query(`DELETE FROM resort.reservations WHERE branch_id = $1`, [scope.branch_id]);
  await c.query(`DELETE FROM resort.rate_dates WHERE branch_id = $1`, [scope.branch_id]);

  // 1. Tipe kamar + unit
  const types = [];
  for (const [i, t] of roomTypes.entries()) {
    const [code, name, zone, adults, children, extraBedMax, weekday, weekend, extraBedRate, amenities, units] = t;
    const { rows } = await c.query(
      `INSERT INTO resort.room_types
         (company_id, branch_id, code, name, description, zone, capacity_adults, capacity_children,
          extra_bed_capacity, rate_weekday, rate_weekend, extra_bed_rate, amenities, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (branch_id, code) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, zone = EXCLUDED.zone,
         capacity_adults = EXCLUDED.capacity_adults, capacity_children = EXCLUDED.capacity_children,
         extra_bed_capacity = EXCLUDED.extra_bed_capacity, rate_weekday = EXCLUDED.rate_weekday,
         rate_weekend = EXCLUDED.rate_weekend, extra_bed_rate = EXCLUDED.extra_bed_rate,
         amenities = EXCLUDED.amenities, sort_order = EXCLUDED.sort_order, is_active = true, updated_at = now()
       RETURNING id`,
      [...base, code, name, `${amenities.join(", ")} — kawasan ${zone}`, zone, adults, children,
       extraBedMax, weekday, weekend, extraBedRate, amenities, (i + 1) * 10, userId]
    );
    const typeId = rows[0].id;
    const rooms = [];
    for (let n = 1; n <= units; n += 1) {
      const roomCode = `${code}-${String(n).padStart(2, "0")}`;
      const { rows: r } = await c.query(
        `INSERT INTO resort.rooms (company_id, branch_id, room_type_id, code, name, zone, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (branch_id, code) DO UPDATE SET
           room_type_id = EXCLUDED.room_type_id, name = EXCLUDED.name, zone = EXCLUDED.zone,
           is_active = true, status = 'siap', updated_at = now()
         RETURNING id, name`,
        [...base, typeId, roomCode, `${name} ${n}`, zone, userId]
      );
      rooms.push({ id: r[0].id, name: r[0].name, busy: [] });
    }
    types.push({ id: typeId, code, name, rate_weekday: weekday, rate_weekend: weekend,
                 extra_bed_rate: extraBedRate, extraBedMax, adults, children, rooms });
  }
  log(`✓ Tipe kamar ${types.length}, unit kamar ${types.reduce((s, t) => s + t.rooms.length, 0)}`);

  // 2. Musim tarif
  for (const s of seasons) {
    const typeId = s.type ? types.find((t) => t.code === s.type)?.id ?? null : null;
    await c.query(
      `INSERT INTO resort.rate_dates (company_id, branch_id, room_type_id, label, start_date, end_date, rate, surcharge_percent, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [...base, typeId, s.label, s.start, s.end, s.rate ?? null, s.surcharge ?? null, userId]
    );
  }
  log(`✓ Musim tarif ${seasons.length}: ${seasons.map((s) => s.label).join(", ")}`);

  // 3. Rencana reservasi
  const random = rng(seed);
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const between = (a, b) => a + Math.floor(random() * (b - a + 1));

  const plans = [];
  for (let i = 0; i < counts.past; i += 1) {
    plans.push({ status: "check-out", start: between(-60, -4), nights: between(1, 3), rooms: random() < 0.2 ? 2 : 1 });
  }
  for (let i = 0; i < counts.inHouse; i += 1) {
    const start = between(-3, 0);
    plans.push({ status: "check-in", start, nights: Math.max(between(1, 4), 1 - start), rooms: random() < 0.25 ? 2 : 1 });
  }
  for (let i = 0; i < counts.upcoming; i += 1) {
    // Dua di antaranya sengaja check-in hari ini supaya papan kedatangan terisi
    plans.push({ status: "terkonfirmasi", start: i < 2 ? 0 : between(1, 30), nights: between(1, 3), rooms: random() < 0.3 ? 2 : 1 });
  }
  for (let i = 0; i < counts.pending; i += 1) plans.push({ status: "menunggu-bayar", start: between(5, 45), nights: between(1, 3), rooms: 1 });
  for (let i = 0; i < counts.cancelled; i += 1) plans.push({ status: "dibatalkan", start: between(-20, 20), nights: between(1, 2), rooms: 1 });
  for (let i = 0; i < counts.noShow; i += 1) plans.push({ status: "no-show", start: between(-30, -10), nights: 1, rooms: 1 });
  plans.sort((a, b) => a.start - b.start);

  let seq = 0, created = 0, assigned = 0, folioRows = 0;
  const stats = {};
  for (const plan of plans) {
    const checkIn = ymd(dayFrom(plan.start));
    const checkOut = ymd(dayFrom(plan.start + plan.nights));
    const type = pick(types);
    const blocks = plan.status !== "dibatalkan" && plan.status !== "no-show";
    const free = type.rooms.filter((r) => !r.busy.some((b) => checkIn < b.out && b.in < checkOut));
    if (blocks && free.length < plan.rooms) continue; // kamar penuh → lewati
    const chosen = blocks ? free.slice(0, plan.rooms) : [];
    const stayed = plan.status === "check-in" || plan.status === "check-out";

    const corporate = random() < 0.12;
    const [guestName, guestPhone] = corporate ? pick(CORPORATE) : pick(GUESTS);
    const source = corporate ? "korporat" : pick(SOURCES.filter((s) => s !== "korporat"));
    const extraBed = type.extraBedMax > 0 && random() < 0.3 ? 1 : 0;
    const adults = between(2, Math.min(type.adults, 6));
    const children = type.children > 0 && random() < 0.5 ? between(1, type.children) : 0;

    const breakdown = [];
    for (let n = 0; n < plan.nights; n += 1) breakdown.push(nightlyRate(type, ymd(dayFrom(plan.start + n)), seasons));
    const perRoom = breakdown.reduce((s, b) => s + b.rate, 0);
    const roomTotal = perRoom * plan.rooms;
    const extraTotal = extraBed * type.extra_bed_rate * plan.nights * plan.rooms;
    const discount = random() < 0.18 ? Math.round((roomTotal * (random() < 0.5 ? 0.05 : 0.1)) / 10_000) * 10_000 : 0;
    const total = roomTotal + extraTotal - discount;

    seq += 1;
    const code = `${codePrefix}${String(seq).padStart(4, "0")}`;
    const createdAt = dayFrom(plan.start - between(2, 21));
    const { rows } = await c.query(
      `INSERT INTO resort.reservations
         (company_id, branch_id, reservation_code, access_token, guest_name, guest_phone, guest_email,
          check_in, check_out, nights, adults, children, status, source, room_total, extra_total,
          discount_amount, total, special_request, created_by, created_by_name, created_at,
          paid_at, checked_in_at, checked_out_at, cancelled_at, cancel_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING id`,
      [...base, code, token(), guestName, guestPhone,
       corporate ? null : `${guestName.split(" ")[0].toLowerCase()}@example.com`,
       checkIn, checkOut, plan.nights, adults, children, plan.status, source,
       roomTotal, extraTotal, discount, total,
       random() < 0.25 ? pick(REQUESTS) : null,
       userId, userName, createdAt,
       plan.status === "menunggu-bayar" ? null : dayFrom(plan.start - 1),
       stayed ? dayFrom(plan.start) : null,
       plan.status === "check-out" ? dayFrom(plan.start + plan.nights) : null,
       plan.status === "dibatalkan" || plan.status === "no-show" ? dayFrom(plan.start - 1) : null,
       plan.status === "dibatalkan" ? pick(["Tamu mengubah rencana", "Cuaca buruk", "Pindah tanggal"])
         : plan.status === "no-show" ? "Tamu tidak datang tanpa kabar" : null]
    );
    const reservationId = rows[0].id;

    for (let i = 0; i < plan.rooms; i += 1) {
      const unit = chosen[i] ?? null;
      if (unit) { unit.busy.push({ in: checkIn, out: checkOut }); assigned += 1; }
      await c.query(
        `INSERT INTO resort.reservation_rooms
           (company_id, branch_id, reservation_id, room_type_id, room_id, room_type_name, room_name,
            nightly_rate, nights, extra_bed, subtotal, guest_name, rate_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [...base, reservationId, type.id, stayed ? unit?.id ?? null : null, type.name,
         stayed ? unit?.name ?? null : null, Math.round(perRoom / plan.nights), plan.nights, extraBed,
         perRoom + extraBed * type.extra_bed_rate * plan.nights, guestName, JSON.stringify(breakdown)]
      );
    }

    const charge = async (kind, direction, description, amount, method = null, at = createdAt) => {
      await c.query(
        `INSERT INTO resort.folio_charges
           (company_id, branch_id, reservation_id, charge_type, direction, description, amount, payment_method, created_by, created_by_name, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [...base, reservationId, kind, direction, description, amount, method, userId, userName, at]
      );
      folioRows += 1;
    };
    await charge("kamar", "debit", `Kamar ${plan.rooms} unit × ${plan.nights} malam (${type.name})`, roomTotal);
    if (extraTotal > 0) await charge("extra-bed", "debit", `Extra bed × ${plan.nights} malam`, extraTotal);
    if (discount > 0) await charge("diskon", "kredit", corporate ? "Diskon korporat" : "Diskon promo", discount);

    let extras = 0;
    if (stayed) {
      for (let i = 0; i < between(1, 2); i += 1) {
        const [desc, amount] = pick(fnbItems);
        extras += amount;
        await charge("fnb", "debit", desc, amount, null, dayFrom(plan.start + Math.min(i, plan.nights - 1)));
      }
      if (random() < 0.5) {
        const [desc, amount] = pick(activities);
        extras += amount;
        await charge("aktivitas", "debit", desc, amount, null, dayFrom(plan.start));
      }
      if (random() < 0.2) { extras += 85_000; await charge("laundry", "debit", "Laundry express 5 potong", 85_000, null, dayFrom(plan.start)); }
      if (random() < 0.08) { extras += 150_000; await charge("denda", "debit", "Kerusakan perlengkapan kamar", 150_000, null, dayFrom(plan.start + plan.nights - 1)); }
    }

    const billed = total + extras;
    if (plan.status === "check-out") {
      await charge("pembayaran", "kredit", "Pelunasan saat check-out", billed, pick(["cash", "kartu kredit", "qris", "transfer"]), dayFrom(plan.start + plan.nights));
    } else if (plan.status === "check-in") {
      const dp = Math.round((total * (random() < 0.5 ? 0.5 : 1)) / 10_000) * 10_000;
      if (dp > 0) await charge("pembayaran", "kredit", dp >= total ? "Pembayaran kamar lunas" : "DP 50% kamar", dp, pick(["transfer", "qris", "kartu kredit"]), dayFrom(plan.start - 1));
    } else if (plan.status === "terkonfirmasi") {
      await charge("pembayaran", "kredit", "DP 50% konfirmasi reservasi", Math.round((total * 0.5) / 10_000) * 10_000, pick(["transfer", "qris"]), dayFrom(plan.start - 2));
    } else if (plan.status === "dibatalkan") {
      const dp = Math.round((total * 0.5) / 10_000) * 10_000;
      await charge("pembayaran", "kredit", "DP 50%", dp, "transfer", dayFrom(plan.start - 3));
      await charge("refund", "kredit", "Refund pembatalan (dikurangi biaya administrasi)", Math.round(dp * 0.8), "transfer", dayFrom(plan.start - 1));
    }

    stats[plan.status] = (stats[plan.status] ?? 0) + 1;
    created += 1;
  }
  log(`✓ Reservasi ${created}: ${Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(", ")} — ${assigned} unit kamar ditetapkan`);

  // 4. Housekeeping: bekas check-out 3 hari terakhir jadi kotor (minimal 3 kamar),
  //    lalu 2 kamar kosong ditandai perbaikan.
  await c.query(
    `UPDATE resort.rooms SET status = 'kotor', updated_at = now()
     WHERE branch_id = $1 AND id IN (
       SELECT rr.room_id FROM resort.reservation_rooms rr
       JOIN resort.reservations r ON r.id = rr.reservation_id
       WHERE r.branch_id = $1 AND r.status = 'check-out' AND r.check_out >= (CURRENT_DATE - 3) AND rr.room_id IS NOT NULL)`,
    [scope.branch_id]
  );
  await c.query(
    `UPDATE resort.rooms SET status = 'kotor', updated_at = now()
     WHERE id IN (
       SELECT r.id FROM resort.rooms r
       WHERE r.branch_id = $1 AND r.status = 'siap'
         AND NOT EXISTS (SELECT 1 FROM resort.reservation_rooms rr JOIN resort.reservations res ON res.id = rr.reservation_id
                         WHERE rr.room_id = r.id AND res.status = 'check-in')
       ORDER BY r.code LIMIT GREATEST(0, 3 - (SELECT COUNT(*) FROM resort.rooms WHERE branch_id = $1 AND status = 'kotor')))`,
    [scope.branch_id]
  );
  await c.query(
    `UPDATE resort.rooms SET status = 'perbaikan', notes = 'Perbaikan pemanas air & pengecatan', updated_at = now()
     WHERE id IN (
       SELECT r.id FROM resort.rooms r
       WHERE r.branch_id = $1 AND r.status = 'siap'
         AND NOT EXISTS (SELECT 1 FROM resort.reservation_rooms rr JOIN resort.reservations res ON res.id = rr.reservation_id
                         WHERE rr.room_id = r.id AND res.status = 'check-in')
       ORDER BY r.code DESC LIMIT 2)`,
    [scope.branch_id]
  );
  const hk = await c.query(
    `SELECT status, COUNT(*)::int AS c FROM resort.rooms WHERE branch_id = $1 GROUP BY status ORDER BY status`,
    [scope.branch_id]
  );
  log(`✓ Status kamar: ${hk.rows.map((r) => `${r.status} ${r.c}`).join(", ")}`);

  const summary = await c.query(
    `SELECT
       (SELECT COUNT(*) FROM resort.reservations WHERE branch_id = $1)::int AS reservasi,
       (SELECT COUNT(*) FROM resort.reservations WHERE branch_id = $1 AND status = 'check-in')::int AS menginap,
       (SELECT COUNT(*) FROM resort.rooms WHERE branch_id = $1)::int AS kamar,
       (SELECT COALESCE(SUM(total), 0) FROM resort.reservations WHERE branch_id = $1 AND status <> 'dibatalkan')::float8 AS nilai`,
    [scope.branch_id]
  );
  return { ...summary.rows[0], folio: folioRows };
}

/** Musim tarif standar: Nataru, libur sekolah, long weekend, promo weekday. */
function defaultSeasons(year, promoTypeCode) {
  const list = [
    { label: "High Season Libur Akhir Tahun", start: `${year}-12-24`, end: `${year + 1}-01-04`, surcharge: 25 },
    { label: "High Season Libur Sekolah", start: `${year}-06-20`, end: `${year}-07-10`, surcharge: 15 },
    { label: "Long Weekend Agustus", start: `${year}-08-15`, end: `${year}-08-18`, surcharge: 10 },
  ];
  if (promoTypeCode) {
    list.push({
      label: "Promo Weekday", start: ymd(dayFrom(-30)), end: ymd(dayFrom(30)),
      surcharge: -10, type: promoTypeCode,
    });
  }
  return list;
}

module.exports = { seedResortDemo, defaultSeasons, dayFrom, ymd };
