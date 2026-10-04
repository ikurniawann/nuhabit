#!/usr/bin/env node
/**
 * Seeder demo Procurement BCD Coffee: supplier, purchase request, purchase order.
 *
 * Seeder supplier bawaan (purchasing-sulu-suppliers.js) membaca Excel milik
 * tenant lama yang tidak ada di repo ini, jadi daftar supplier di sini ditulis
 * langsung dan disesuaikan dengan bahan baku kedai kopi.
 *
 * Idempotent: supplier upsert per kode; PR/PO dikenali lewat nomor dokumen
 * ber-prefix DEMO- sehingga dijalankan ulang tidak menggandakan.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-demo-procurement.js
 *   npm run db:seed:bcdcoffee-procurement
 */

const { dayFrom, runSeeder, anyAdmin } = require("./lib/bcdcoffee-demo");

const SUPPLIERS = [
  ["SUP-BCD-001", "CV Gayo Highland Coffee", "Rahmat Iskandar", "081122334455", "Takengon", "kopi", "Roaster & eksportir biji arabica Gayo", "NET 30"],
  ["SUP-BCD-002", "PT Kintamani Bali Bean", "Wayan Suarta", "081233445566", "Bangli", "kopi", "Biji arabica Kintamani, pengiriman mingguan", "NET 14"],
  ["SUP-BCD-003", "CV Sumber Susu Lembang", "Dewi Puspita", "081344556677", "Bandung Barat", "dairy", "Fresh milk barista & produk olahan susu", "NET 7"],
  ["SUP-BCD-004", "PT Sirup Nusantara", "Andi Prakoso", "081455667788", "Bekasi", "minuman", "Sirup, bubuk minuman, dan pemanis", "NET 30"],
  ["SUP-BCD-005", "CV Kemasan Prima", "Lina Mardiana", "081566778899", "Bandung", "kemasan", "Cup, lid, paper bag custom bermerek", "NET 30"],
  ["SUP-BCD-006", "Toko Bahan Kue Sejahtera", "Hendra Wijaya", "081677889900", "Bandung", "bakery", "Tepung, gula, butter, dan bahan pastry", "COD"],
  ["SUP-BCD-007", "PT Gas Mitra Energi", "Siti Aminah", "081788990011", "Bandung", "operasional", "LPG dan perlengkapan dapur", "COD"],
];

/**
 * [nomor, prioritas, status, catatan, hari_dibutuhkan, total]
 * Prioritas sah: low | medium | high | urgent.
 * Status sah: draft | pending_head | pending_finance | pending_direksi |
 *             approved | rejected | converted.
 */
const PURCHASE_REQUESTS = [
  ["DEMO-PR-2601", "high", "approved", "Restock biji kopi house blend & arabica untuk 2 minggu", 5, 7_250_000],
  ["DEMO-PR-2602", "medium", "pending_head", "Kebutuhan susu & sirup mingguan", 3, 3_180_000],
  ["DEMO-PR-2603", "urgent", "pending_finance", "Cup dan lid menipis, stok tersisa 2 hari", 2, 2_480_000],
  ["DEMO-PR-2604", "low", "draft", "Usulan tambahan varian teh untuk menu baru", 14, 940_000],
];

/** [nomor, supplier_kode, status, subtotal, ppn%, catatan, hari_po, hari_kirim] */
const PURCHASE_ORDERS = [
  ["DEMO-PO-2601", "SUP-BCD-001", "approved", 5_800_000, 11, "Arabica Gayo 20kg + house blend 20kg", -6, 1],
  ["DEMO-PO-2602", "SUP-BCD-003", "sent", 2_400_000, 11, "Fresh milk barista 10 karton", -3, 1],
  ["DEMO-PO-2603", "SUP-BCD-005", "approved", 2_230_000, 11, "Paper cup 12oz 2 dos + lid 2 dos", -2, 3],
  ["DEMO-PO-2604", "SUP-BCD-004", "draft", 1_450_000, 11, "Sirup vanilla, caramel, gula aren", 0, 7],
];

runSeeder("Seeding demo Procurement", async (c, scope) => {
  const admin = await anyAdmin(c);

  // ── Supplier ──────────────────────────────────────────────────────────────
  const supplierIds = new Map();
  for (const [kode, nama, pic, phone, kota, kategori, catatan, terms] of SUPPLIERS) {
    const { rows } = await c.query(
      `INSERT INTO purchasing.suppliers
         (kode, nama_supplier, pic_name, pic_phone, telepon, kota, kategori, catatan,
          payment_terms, currency, status, is_active, company_id, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,'IDR','active',true,$9,$10,$11)
       ON CONFLICT (
         COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
         COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
         kode
       ) WHERE deleted_at IS NULL
       DO UPDATE SET
         nama_supplier = EXCLUDED.nama_supplier,
         pic_name = EXCLUDED.pic_name,
         pic_phone = EXCLUDED.pic_phone,
         telepon = EXCLUDED.telepon,
         kota = EXCLUDED.kota,
         kategori = EXCLUDED.kategori,
         catatan = EXCLUDED.catatan,
         payment_terms = EXCLUDED.payment_terms,
         is_active = true,
         deleted_at = NULL,
         updated_at = NOW()
       RETURNING id`,
      [kode, nama, pic, phone, kota, kategori, catatan, terms, scope.company_id, scope.branch_id, admin?.id ?? null]
    );
    supplierIds.set(kode, rows[0].id);
    console.log(`  ✓ supplier ${kode} — ${nama}`);
  }

  // ── Purchase Request ──────────────────────────────────────────────────────
  // requester & department wajib: pakai karyawan mana pun yang ada.
  const { rows: emp } = await c.query(
    `SELECT id, department_id FROM hris.employees WHERE is_active AND department_id IS NOT NULL ORDER BY created_at LIMIT 1`
  );
  const { rows: dept } = await c.query(`SELECT id FROM hris.departments ORDER BY created_at LIMIT 1`);
  const requesterId = emp[0]?.id ?? null;
  const departmentId = emp[0]?.department_id ?? dept[0]?.id ?? null;

  let prCount = 0;
  if (!requesterId || !departmentId) {
    console.log("  ! PR dilewati: butuh minimal 1 karyawan aktif + 1 departemen (jalankan seeder HRIS dulu).");
  } else {
    for (const [nomor, prio, status, notes, needDays, total] of PURCHASE_REQUESTS) {
      await c.query(
        `INSERT INTO purchasing.purchase_requests
           (pr_number, requester_id, department_id, status, total_amount, priority, notes,
            required_date, company_id, branch_id, module_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,'raw_material')
         ON CONFLICT (pr_number) DO UPDATE SET
           status = EXCLUDED.status,
           total_amount = EXCLUDED.total_amount,
           priority = EXCLUDED.priority,
           notes = EXCLUDED.notes,
           required_date = EXCLUDED.required_date,
           updated_at = NOW()`,
        [nomor, requesterId, departmentId, status, total, prio, notes, dayFrom(needDays), scope.company_id, scope.branch_id]
      );
      prCount += 1;
      console.log(`  ✓ PR ${nomor} (${status})`);
    }
  }

  // ── Purchase Order ────────────────────────────────────────────────────────
  let poCount = 0;
  for (const [nomor, supKode, status, subtotal, ppnPersen, catatan, poDay, kirimDay] of PURCHASE_ORDERS) {
    const ppn = Math.round((subtotal * ppnPersen) / 100);
    await c.query(
      `INSERT INTO purchasing.purchase_orders
         (nomor_po, tanggal_po, tanggal_dibutuhkan, tanggal_kirim_estimasi, supplier_id, status,
          subtotal, ppn_persen, ppn_nominal, total, catatan, is_active,
          company_id, branch_id, module_type, source_type, created_by)
       VALUES ($1,$2::date,$3::date,$3::date,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,'raw_material','manual',$13)
       ON CONFLICT (nomor_po) DO UPDATE SET
         status = EXCLUDED.status,
         subtotal = EXCLUDED.subtotal,
         ppn_persen = EXCLUDED.ppn_persen,
         ppn_nominal = EXCLUDED.ppn_nominal,
         total = EXCLUDED.total,
         catatan = EXCLUDED.catatan,
         is_active = true,
         deleted_at = NULL,
         updated_at = NOW()`,
      [
        nomor, dayFrom(poDay), dayFrom(kirimDay), supplierIds.get(supKode) ?? null, status,
        subtotal, ppnPersen, ppn, subtotal + ppn, catatan,
        scope.company_id, scope.branch_id, admin?.id ?? null,
      ]
    );
    poCount += 1;
    console.log(`  ✓ PO ${nomor} — ${catatan} (${status})`);
  }

  return { supplier: SUPPLIERS.length, "purchase request": prCount, "purchase order": poCount };
});
