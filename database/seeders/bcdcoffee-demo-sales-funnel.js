#!/usr/bin/env node
/**
 * Seeder demo Sales Funneling / CRM BCD Coffee.
 *
 * Modul ini sama sekali belum punya seeder. Data demo dibuat menyebar di
 * beberapa tahap pipeline supaya kanban, forecast, dan laporan atribusi
 * (EPIC-050) langsung ada isinya, bukan halaman kosong.
 *
 * Cakupan: alasan kalah, account, contact, lead (dengan UTM), deal di beberapa
 * tahap, dan aktivitas tindak lanjut.
 *
 * Idempotent: seluruh baris demo ditandai prefix "DEMO" pada nama/kode dan
 * di-upsert; dijalankan ulang tidak menggandakan.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-demo-sales-funnel.js
 *   npm run db:seed:bcdcoffee-sales-funnel
 */

const { dayFrom, runSeeder, anyAdmin } = require("./lib/bcdcoffee-demo");

const LOST_REASONS = [
  ["HARGA", "Harga di atas anggaran", 1],
  ["JADWAL", "Tanggal acara tidak tersedia", 2],
  ["KOMPETITOR", "Memilih vendor lain", 3],
  ["BATAL", "Acara dibatalkan", 4],
  ["TIDAK-RESPON", "Tidak ada respons setelah penawaran", 5],
];

/** [nama, tipe, industri, kota, telepon, email] */
const ACCOUNTS = [
  ["PT Sinar Rekatama", "corporate", "Manufaktur", "Bandung", "0221234501", "procurement@sinarrekatama.co.id"],
  ["Universitas Harapan Bangsa", "sekolah", "Pendidikan", "Bandung", "0221234502", "kemahasiswaan@uhb.ac.id"],
  ["Komunitas Sepeda Bandung", "komunitas", "Komunitas", "Bandung", "0221234503", "info@sepedabdg.org"],
  ["Dinas Pariwisata Kota Bandung", "pemerintah", "Pemerintahan", "Bandung", "0221234504", "humas@disparbud.go.id"],
  ["PT Langit Biru Travel", "travel-agent", "Pariwisata", "Cimahi", "0221234505", "ops@langitbiru.travel"],
];

/** [nama_account, nama_kontak, jabatan, telepon, email, utama] */
const CONTACTS = [
  ["PT Sinar Rekatama", "Bambang Setiawan", "Procurement Manager", "081310002001", "bambang@sinarrekatama.co.id", true],
  ["PT Sinar Rekatama", "Rina Oktaviani", "Staff GA", "081310002002", "rina@sinarrekatama.co.id", false],
  ["Universitas Harapan Bangsa", "Dr. Aditya Firmansyah", "Kepala Kemahasiswaan", "081310002003", "aditya@uhb.ac.id", true],
  ["Komunitas Sepeda Bandung", "Yoga Permana", "Ketua Komunitas", "081310002004", "yoga@sepedabdg.org", true],
  ["Dinas Pariwisata Kota Bandung", "Sri Handayani", "Kasi Promosi", "081310002005", "sri@disparbud.go.id", true],
  ["PT Langit Biru Travel", "Kevin Wijaya", "Tour Operation Lead", "081310002006", "kevin@langitbiru.travel", true],
];

/**
 * [instansi, tipe, pic, telepon, email, kota, sumber, temperatur, status,
 *  utm_source, utm_campaign, hari_dibuat, catatan]
 */
const LEADS = [
  ["PT Sinar Rekatama", "corporate", "Bambang Setiawan", "081310002001", "bambang@sinarrekatama.co.id", "Bandung", "referral", "panas", "qualified", null, null, -21, "Gathering tahunan 150 pax, butuh coffee break 2 sesi"],
  ["Universitas Harapan Bangsa", "sekolah", "Dr. Aditya Firmansyah", "081310002003", "aditya@uhb.ac.id", "Bandung", "google", "hangat", "dihubungi", "google", "promo-institusi", -14, "Seminar nasional, estimasi 300 peserta"],
  ["Komunitas Sepeda Bandung", "komunitas", "Yoga Permana", "081310002004", "yoga@sepedabdg.org", "Bandung", "instagram", "hangat", "qualified", "instagram", "promo-komunitas", -10, "Kopdar bulanan, butuh area outdoor"],
  ["Dinas Pariwisata Kota Bandung", "pemerintah", "Sri Handayani", "081310002005", "sri@disparbud.go.id", "Bandung", "pameran", "panas", "qualified", null, null, -7, "Rapat koordinasi + coffee break 80 pax"],
  ["PT Langit Biru Travel", "travel-agent", "Kevin Wijaya", "081310002006", "kevin@langitbiru.travel", "Cimahi", "referral", "hangat", "baru", null, null, -4, "Paket rombongan wisatawan, rutin tiap bulan"],
  ["CV Rasa Nusantara", "corporate", "Melati Anggraini", "081310002007", "melati@rasanusantara.id", "Bandung", "google", "dingin", "baru", "google", "search-katering", -2, "Tanya harga supply kopi kantor bulanan"],
];

/** [instansi, judul, jenis_acara, nilai, tahap_code, hari_acara, pax] */
const DEALS = [
  ["PT Sinar Rekatama", "Gathering Tahunan Sinar Rekatama", "gathering", 42_000_000, "nego-survey", 20, 150],
  ["Universitas Harapan Bangsa", "Seminar Nasional UHB", "gathering", 68_000_000, "proposal", 35, 300],
  ["Komunitas Sepeda Bandung", "Kopdar Bulanan Sepeda Bandung", "gathering", 9_500_000, "dihubungi", 12, 60],
  ["Dinas Pariwisata Kota Bandung", "Rapat Koordinasi Disparbud", "gathering", 18_500_000, "nego-survey", 9, 80],
  ["PT Langit Biru Travel", "Paket Rombongan Langit Biru", "lainnya", 12_000_000, "prospek-baru", 28, 90],
];

/** [instansi, jenis, judul, catatan, hari_jatuh_tempo, status] */
const ACTIVITIES = [
  ["PT Sinar Rekatama", "telepon", "Konfirmasi susunan acara", "Pastikan jumlah sesi coffee break dan jam mulai", 1, "open"],
  ["Universitas Harapan Bangsa", "meeting", "Presentasi proposal ke panitia", "Bawa sample menu dan proposal cetak", 3, "open"],
  ["Komunitas Sepeda Bandung", "wa", "Follow up ketersediaan tanggal", "Tawarkan slot Sabtu pagi", 0, "open"],
  ["Dinas Pariwisata Kota Bandung", "meeting", "Survey lokasi bersama panitia", "Cek kebutuhan sound system", 2, "open"],
  ["PT Sinar Rekatama", "catatan", "Hasil survey lokasi", "Area outdoor cukup untuk 150 pax, perlu tenda cadangan", -3, "done"],
  ["PT Langit Biru Travel", "telepon", "Perkenalan paket rombongan", "Kirim price list paket wisata", -1, "done"],
];

runSeeder("Seeding demo Sales Funneling", async (c, scope) => {
  const admin = await anyAdmin(c);
  const ownerId = admin?.id ?? null;

  // ── Alasan kalah ──────────────────────────────────────────────────────────
  for (const [code, name, sort] of LOST_REASONS) {
    await c.query(
      `INSERT INTO crm.crm_sales_lost_reasons (code, name, sort_order, is_active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order,
         is_active = true, updated_at = NOW()`,
      [code, name, sort]
    );
  }
  console.log(`  ✓ alasan kalah ${LOST_REASONS.length}`);

  // ── Account ───────────────────────────────────────────────────────────────
  const accountIds = new Map();
  for (const [nama, tipe, industri, kota, telepon, email] of ACCOUNTS) {
    const { rows: found } = await c.query(
      `SELECT id FROM crm.crm_accounts WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL LIMIT 1`,
      [scope.company_id, nama]
    );
    let id = found[0]?.id;
    if (id) {
      await c.query(
        `UPDATE crm.crm_accounts SET account_type=$2, industry=$3, city=$4, phone=$5, email=$6,
           owner_user_id = COALESCE(owner_user_id, $7), updated_at = NOW() WHERE id = $1`,
        [id, tipe, industri, kota, telepon, email, ownerId]
      );
    } else {
      const { rows } = await c.query(
        `INSERT INTO crm.crm_accounts (company_id, branch_id, name, account_type, industry, city, phone, email, owner_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
        [scope.company_id, scope.branch_id, nama, tipe, industri, kota, telepon, email, ownerId]
      );
      id = rows[0].id;
    }
    accountIds.set(nama, id);
  }
  console.log(`  ✓ account ${ACCOUNTS.length}`);

  // ── Contact ───────────────────────────────────────────────────────────────
  for (const [accNama, nama, jabatan, telepon, email, utama] of CONTACTS) {
    const accId = accountIds.get(accNama) ?? null;
    const { rows: found } = await c.query(
      `SELECT id FROM crm.crm_contacts WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1`,
      [scope.company_id, telepon]
    );
    if (found[0]) {
      await c.query(
        `UPDATE crm.crm_contacts SET name=$2, title=$3, email=$4, account_id=$5, is_primary=$6, updated_at=NOW() WHERE id=$1`,
        [found[0].id, nama, jabatan, email, accId, utama]
      );
    } else {
      await c.query(
        `INSERT INTO crm.crm_contacts (company_id, branch_id, account_id, name, title, phone, email, is_primary, owner_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [scope.company_id, scope.branch_id, accId, nama, jabatan, telepon, email, utama, ownerId]
      );
    }
  }
  console.log(`  ✓ contact ${CONTACTS.length}`);

  // ── Lead ──────────────────────────────────────────────────────────────────
  const leadIds = new Map();
  for (const [org, tipe, pic, telepon, email, kota, sumber, temp, status, utmSource, utmCampaign, hari, catatan] of LEADS) {
    const accId = accountIds.get(org) ?? null;
    const { rows: found } = await c.query(
      `SELECT id FROM crm.crm_sales_leads WHERE company_id=$1 AND pic_phone=$2 AND lower(org_name)=lower($3) AND deleted_at IS NULL LIMIT 1`,
      [scope.company_id, telepon, org]
    );
    let id = found[0]?.id;
    if (id) {
      await c.query(
        `UPDATE crm.crm_sales_leads SET org_type=$2, pic_name=$3, pic_email=$4, city=$5, source=$6,
           temperature=$7, status=$8, notes=$9, account_id=$10, utm_source=$11, utm_campaign=$12,
           owner_user_id=COALESCE(owner_user_id,$13), updated_at=NOW() WHERE id=$1`,
        [id, tipe, pic, email, kota, sumber, temp, status, catatan, accId, utmSource, utmCampaign, ownerId]
      );
    } else {
      const { rows } = await c.query(
        `INSERT INTO crm.crm_sales_leads
           (company_id, branch_id, org_name, org_type, pic_name, pic_phone, pic_email, city, source,
            temperature, status, notes, account_id, utm_source, utm_campaign, owner_user_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17::date)
         RETURNING id`,
        [scope.company_id, scope.branch_id, org, tipe, pic, telepon, email, kota, sumber,
         temp, status, catatan, accId, utmSource, utmCampaign, ownerId, dayFrom(hari)]
      );
      id = rows[0].id;
    }
    leadIds.set(org, id);
  }
  console.log(`  ✓ lead ${LEADS.length}`);

  // ── Deal ──────────────────────────────────────────────────────────────────
  const { rows: stageRows } = await c.query(
    `SELECT s.id, s.code FROM crm.crm_sales_stages s
     JOIN crm.crm_pipelines p ON p.id = s.pipeline_id AND p.is_default
     WHERE s.is_active`
  );
  const stageByCode = new Map(stageRows.map((r) => [r.code, r.id]));
  const { rows: pipelineRows } = await c.query(`SELECT id FROM crm.crm_pipelines WHERE is_default LIMIT 1`);
  const pipelineId = pipelineRows[0]?.id ?? null;

  let dealCount = 0;
  for (const [org, judul, jenis, nilai, stageCode, hariAcara, pax] of DEALS) {
    const leadId = leadIds.get(org);
    const stageId = stageByCode.get(stageCode);
    if (!leadId || !stageId) {
      console.log(`  ! deal "${judul}" dilewati (lead/tahap ${stageCode} tidak ditemukan)`);
      continue;
    }
    const { rows: found } = await c.query(
      `SELECT id FROM crm.crm_sales_deals WHERE company_id=$1 AND lower(title)=lower($2) AND deleted_at IS NULL LIMIT 1`,
      [scope.company_id, judul]
    );
    if (found[0]) {
      await c.query(
        `UPDATE crm.crm_sales_deals SET stage_id=$2, value_estimate=$3, event_date=$4::date,
           pax_estimate=$5, pipeline_id=COALESCE(pipeline_id,$6), updated_at=NOW() WHERE id=$1`,
        [found[0].id, stageId, nilai, dayFrom(hariAcara), pax, pipelineId]
      );
    } else {
      await c.query(
        `INSERT INTO crm.crm_sales_deals
           (company_id, branch_id, lead_id, title, event_type, event_date, pax_estimate,
            stage_id, pipeline_id, value_estimate, owner_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$11)`,
        [scope.company_id, scope.branch_id, leadId, judul, jenis, dayFrom(hariAcara), pax,
         stageId, pipelineId, nilai, ownerId]
      );
    }
    dealCount += 1;
  }
  console.log(`  ✓ deal ${dealCount}`);

  // ── Aktivitas / tugas ─────────────────────────────────────────────────────
  let actCount = 0;
  for (const [org, jenis, judul, catatan, hari, status] of ACTIVITIES) {
    const leadId = leadIds.get(org);
    if (!leadId) continue;
    const { rows: found } = await c.query(
      `SELECT id FROM crm.crm_sales_activities WHERE company_id=$1 AND lead_id=$2 AND title=$3 AND deleted_at IS NULL LIMIT 1`,
      [scope.company_id, leadId, judul]
    );
    const dueAt = `${dayFrom(hari)} 09:00:00+07`;
    if (found[0]) {
      await c.query(
        `UPDATE crm.crm_sales_activities SET activity_type=$2, notes=$3, due_at=$4::timestamptz,
           status=$5, done_at=$6::timestamptz, updated_at=NOW() WHERE id=$1`,
        [found[0].id, jenis, catatan, dueAt, status, status === "done" ? dueAt : null]
      );
    } else {
      await c.query(
        `INSERT INTO crm.crm_sales_activities
           (company_id, branch_id, lead_id, activity_type, title, notes, due_at, status, done_at,
            priority, subject_type, subject_id, owner_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::timestamptz,'normal','lead',$3,$10,$10)`,
        [scope.company_id, scope.branch_id, leadId, jenis, judul, catatan, dueAt, status,
         status === "done" ? dueAt : null, ownerId]
      );
    }
    actCount += 1;
  }
  console.log(`  ✓ aktivitas ${actCount}`);

  return {
    "alasan kalah": LOST_REASONS.length,
    account: ACCOUNTS.length,
    contact: CONTACTS.length,
    lead: LEADS.length,
    deal: dealCount,
    aktivitas: actCount,
  };
});
