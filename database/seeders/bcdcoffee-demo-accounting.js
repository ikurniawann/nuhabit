#!/usr/bin/env node
/**
 * Seeder demo Accounting BCD Coffee: tahun buku, periode, dan jurnal contoh.
 *
 * Melengkapi accounting-sulu-coa.js yang hanya mengisi Chart of Accounts.
 * Tanpa fiscal_periods, jurnal tidak bisa dibuat sama sekali karena
 * journal_entries.fiscal_period_id bersifat wajib.
 *
 * Jurnal demo dibuat berpasangan (debit = kredit) dan diverifikasi seimbang
 * sebelum commit — jurnal timpang lebih berbahaya daripada tidak ada jurnal.
 *
 * Idempotent: tahun buku per kode, periode per (tahun, nomor), jurnal per nomor.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-demo-accounting.js
 *   npm run db:seed:bcdcoffee-accounting
 */

const { runSeeder, anyAdmin } = require("./lib/bcdcoffee-demo");

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * Jurnal contoh. Tiap baris: [nomor, deskripsi, offsetHariDariHariIni, baris[]]
 * baris: [kodeAkunCOA, 'D'|'C', jumlah, memo]
 * Kode akun dicocokkan ke accounting.chart_of_accounts; yang tidak ketemu
 * membuat jurnalnya dilewati dengan peringatan, bukan diam-diam timpang.
 */
function journalTemplates() {
  return [
    {
      nomor: "DEMO-JV-0001",
      deskripsi: "Penjualan tunai harian coffee shop",
      offset: -7,
      lines: [
        ["1101002", "D", 4_850_000, "Petty Cash"],
        ["4101002", "C", 4_850_000, "Beverage Revenue"],
      ],
    },
    {
      nomor: "DEMO-JV-0002",
      deskripsi: "Pembelian biji kopi dari CV Gayo Highland",
      offset: -6,
      lines: [
        ["1301001", "D", 5_800_000, "Inv - ST Dry Goods"],
        ["2101001", "C", 5_800_000, "AP - Raw Material & Supplies"],
      ],
    },
    {
      nomor: "DEMO-JV-0003",
      deskripsi: "Pembayaran gaji karyawan",
      offset: -5,
      lines: [
        ["6101001", "D", 28_500_000, "Beban gaji"],
        ["1102001", "C", 28_500_000, "BANK BCA 7319"],
      ],
    },
    {
      nomor: "DEMO-JV-0004",
      deskripsi: "Beban sewa tempat bulanan",
      offset: -4,
      lines: [
        ["6401001", "D", 15_000_000, "Rent & Occupancy Expense"],
        ["1102001", "C", 15_000_000, "BANK BCA 7319"],
      ],
    },
    {
      nomor: "DEMO-JV-0005",
      deskripsi: "Pelunasan utang supplier",
      offset: -2,
      lines: [
        ["2101001", "D", 5_800_000, "Pelunasan AP"],
        ["1102001", "C", 5_800_000, "BANK BCA 7319"],
      ],
    },
  ];
}

runSeeder("Seeding demo Accounting", async (c, scope) => {
  const admin = await anyAdmin(c);
  const year = new Date().getFullYear();

  // ── Tahun buku ────────────────────────────────────────────────────────────
  const code = `FY${year}`;
  const { rows: fyFound } = await c.query(
    `SELECT id FROM accounting.fiscal_years
     WHERE code = $1 AND (company_id IS NULL OR company_id = $2) AND deleted_at IS NULL LIMIT 1`,
    [code, scope.company_id]
  );
  let fiscalYearId = fyFound[0]?.id;
  if (!fiscalYearId) {
    const { rows } = await c.query(
      `INSERT INTO accounting.fiscal_years (company_id, code, name, start_date, end_date, is_active, created_by)
       VALUES ($1,$2,$3,$4::date,$5::date,true,$6) RETURNING id`,
      [scope.company_id, code, `Tahun Buku ${year}`, `${year}-01-01`, `${year}-12-31`, admin?.id ?? null]
    );
    fiscalYearId = rows[0].id;
  }
  console.log(`  ✓ tahun buku ${code}`);

  // ── 12 periode bulanan ────────────────────────────────────────────────────
  const periodIds = new Map();
  const nowMonth = new Date().getMonth() + 1;
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${String(m).padStart(2, "0")}-01`;
    const end = new Date(year, m, 0).toISOString().slice(0, 10);
    // Bulan lampau ditutup, bulan berjalan & mendatang terbuka.
    const status = m < nowMonth ? "CLOSED" : "OPEN"; // enum huruf besar
    const { rows: found } = await c.query(
      `SELECT id FROM accounting.fiscal_periods WHERE fiscal_year_id = $1 AND period_no = $2 LIMIT 1`,
      [fiscalYearId, m]
    );
    let id = found[0]?.id;
    if (id) {
      await c.query(
        `UPDATE accounting.fiscal_periods SET name=$2, start_date=$3::date, end_date=$4::date, status=$5, updated_at=NOW() WHERE id=$1`,
        [id, `${BULAN[m - 1]} ${year}`, start, end, status]
      );
    } else {
      const { rows } = await c.query(
        `INSERT INTO accounting.fiscal_periods (fiscal_year_id, period_no, name, start_date, end_date, status)
         VALUES ($1,$2,$3,$4::date,$5::date,$6) RETURNING id`,
        [fiscalYearId, m, `${BULAN[m - 1]} ${year}`, start, end, status]
      );
      id = rows[0].id;
    }
    periodIds.set(m, id);
  }
  console.log(`  ✓ periode 12 bulan (${nowMonth - 1} ditutup, ${12 - nowMonth + 1} terbuka)`);

  // ── Jurnal ────────────────────────────────────────────────────────────────
  const { rows: coaRows } = await c.query(
    `SELECT id, code FROM accounting.chart_of_accounts
     WHERE (company_id IS NULL OR company_id = $1) AND deleted_at IS NULL`,
    [scope.company_id]
  );
  const coaByCode = new Map(coaRows.map((r) => [String(r.code), r.id]));

  let journalCount = 0;
  let skipped = 0;
  for (const tpl of journalTemplates()) {
    const missing = tpl.lines.filter(([kode]) => !coaByCode.has(kode)).map(([kode]) => kode);
    if (missing.length > 0) {
      console.log(`  ! ${tpl.nomor} dilewati — akun COA tidak ada: ${missing.join(", ")}`);
      skipped += 1;
      continue;
    }
    const debit = tpl.lines.filter(([, s]) => s === "D").reduce((a, [, , n]) => a + n, 0);
    const kredit = tpl.lines.filter(([, s]) => s === "C").reduce((a, [, , n]) => a + n, 0);
    if (debit !== kredit) throw new Error(`${tpl.nomor} tidak seimbang: debit ${debit} vs kredit ${kredit}`);

    const d = new Date();
    d.setDate(d.getDate() + tpl.offset);
    const entryDate = d.toISOString().slice(0, 10);
    const periodId = periodIds.get(d.getMonth() + 1);

    const { rows: found } = await c.query(
      `SELECT id FROM accounting.journal_entries WHERE entry_no = $1 AND deleted_at IS NULL LIMIT 1`,
      [tpl.nomor]
    );
    let entryId = found[0]?.id;
    if (entryId) {
      await c.query(
        `UPDATE accounting.journal_entries SET entry_date=$2::date, description=$3, fiscal_period_id=$4, updated_at=NOW() WHERE id=$1`,
        [entryId, entryDate, tpl.deskripsi, periodId]
      );
      await c.query(`DELETE FROM accounting.journal_entry_lines WHERE entry_id = $1`, [entryId]);
    } else {
      const { rows } = await c.query(
        `INSERT INTO accounting.journal_entries
           (company_id, entry_no, entry_date, description, fiscal_period_id, status, entry_type, source_module, created_by)
         VALUES ($1,$2,$3::date,$4,$5,'POSTED','MANUAL','seeder',$6) RETURNING id`,
        [scope.company_id, tpl.nomor, entryDate, tpl.deskripsi, periodId, admin?.id ?? null]
      );
      entryId = rows[0].id;
    }

    let sort = 1;
    for (const [kode, sisi, jumlah, memo] of tpl.lines) {
      await c.query(
        `INSERT INTO accounting.journal_entry_lines (entry_id, account_id, entry_side, amount, memo, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        // entry_side memakai huruf besar sesuai CHECK constraint.
        [entryId, coaByCode.get(kode), sisi === "D" ? "DEBIT" : "CREDIT", jumlah, memo, sort++]
      );
    }
    journalCount += 1;
    console.log(`  ✓ jurnal ${tpl.nomor} — ${tpl.deskripsi}`);
  }

  // Verifikasi akhir: tidak boleh ada jurnal demo yang timpang.
  const { rows: check } = await c.query(
    `SELECT je.entry_no,
            SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END) AS d,
            SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END) AS k
     FROM accounting.journal_entries je
     JOIN accounting.journal_entry_lines l ON l.entry_id = je.id
     WHERE je.entry_no LIKE 'DEMO-JV-%' AND je.deleted_at IS NULL
     GROUP BY je.entry_no
     HAVING SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END)
         <> SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END)`
  );
  if (check.length > 0) throw new Error(`Jurnal timpang: ${check.map((r) => r.entry_no).join(", ")}`);

  return { "tahun buku": 1, periode: 12, jurnal: journalCount, dilewati: skipped };
});
