#!/usr/bin/env node
/**
 * Seeder: HRIS master data — departments, employment statuses, positions.
 *
 * Idempotent (upsert by unique code / title+department).
 *
 * Usage:
 *   node database/seeders/hris-master-data.js
 *   npm run db:seed:hris-master
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

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

const DEPARTMENTS = [
  { code: "HR", name: "Human Resources", description: "Rekrutmen, pengembangan SDM, dan kebijakan ketenagakerjaan" },
  { code: "FIN", name: "Finance & Accounting", description: "Keuangan, akuntansi, dan pelaporan" },
  { code: "OPS", name: "Operations", description: "Operasional harian dan layanan inti bisnis" },
  { code: "MKT", name: "Marketing", description: "Branding, promosi, dan komunikasi pemasaran" },
  { code: "SLS", name: "Sales", description: "Penjualan dan hubungan pelanggan" },
  { code: "IT", name: "Information Technology", description: "Infrastruktur, aplikasi, dan dukungan teknis" },
  { code: "PROC", name: "Procurement", description: "Pengadaan barang dan jasa" },
  { code: "WHL", name: "Warehouse & Logistics", description: "Gudang, distribusi, dan logistik" },
  { code: "QA", name: "Quality Assurance", description: "Standar kualitas produk dan layanan" },
  { code: "GA", name: "General Affairs", description: "Administrasi umum dan fasilitas" },
];

const EMPLOYMENT_STATUSES = [
  { code: "probation", name: "Probasi", color: "yellow", description: "Masa percobaan kerja" },
  { code: "contract", name: "Kontrak", color: "blue", description: "Karyawan kontrak (PKWT)" },
  { code: "permanent", name: "Tetap", color: "green", description: "Karyawan tetap (PKWTT)" },
  { code: "internship", name: "Magang", color: "purple", description: "Peserta magang atau internship" },
  { code: "resigned", name: "Resign", color: "red", description: "Mengundurkan diri" },
  { code: "terminated", name: "PHK", color: "red", description: "Pemutusan hubungan kerja" },
  { code: "suspended", name: "Suspend", color: "orange", description: "Ditangguhkan sementara" },
];

const POSITIONS = [
  // Human Resources
  { title: "HR Manager", department: "Human Resources", level: "Manager" },
  { title: "HR Supervisor", department: "Human Resources", level: "Supervisor" },
  { title: "HR Staff", department: "Human Resources", level: "Staff" },
  { title: "Recruitment Specialist", department: "Human Resources", level: "Senior Staff" },
  // Finance
  { title: "Finance Manager", department: "Finance & Accounting", level: "Manager" },
  { title: "Accounting Supervisor", department: "Finance & Accounting", level: "Supervisor" },
  { title: "Staff Accounting", department: "Finance & Accounting", level: "Staff" },
  { title: "Cashier", department: "Finance & Accounting", level: "Staff" },
  // Operations
  { title: "Operations Manager", department: "Operations", level: "Manager" },
  { title: "Operations Supervisor", department: "Operations", level: "Supervisor" },
  { title: "Operations Staff", department: "Operations", level: "Staff" },
  { title: "General Manager", department: "Operations", level: "General Manager" },
  // Marketing
  { title: "Marketing Manager", department: "Marketing", level: "Manager" },
  { title: "Digital Marketing Specialist", department: "Marketing", level: "Senior Staff" },
  { title: "Marketing Staff", department: "Marketing", level: "Staff" },
  // Sales
  { title: "Sales Manager", department: "Sales", level: "Manager" },
  { title: "Sales Supervisor", department: "Sales", level: "Supervisor" },
  { title: "Sales Representative", department: "Sales", level: "Staff" },
  // IT
  { title: "IT Manager", department: "Information Technology", level: "Manager" },
  { title: "System Administrator", department: "Information Technology", level: "Senior Staff" },
  { title: "Software Developer", department: "Information Technology", level: "Staff" },
  { title: "IT Support", department: "Information Technology", level: "Staff" },
  // Procurement
  { title: "Purchasing Manager", department: "Procurement", level: "Manager" },
  { title: "Purchasing Staff", department: "Procurement", level: "Staff" },
  // Warehouse
  { title: "Warehouse Supervisor", department: "Warehouse & Logistics", level: "Supervisor" },
  { title: "Warehouse Staff", department: "Warehouse & Logistics", level: "Staff" },
  { title: "Logistics Coordinator", department: "Warehouse & Logistics", level: "Senior Staff" },
  // QA
  { title: "QC Supervisor", department: "Quality Assurance", level: "Supervisor" },
  { title: "QC Staff", department: "Quality Assurance", level: "Staff" },
  // GA
  { title: "Office Manager", department: "General Affairs", level: "Manager" },
  { title: "Admin Staff", department: "General Affairs", level: "Staff" },
  { title: "Driver", department: "General Affairs", level: "Staff" },
  // Executive
  { title: "Director", department: "Operations", level: "Director" },
  { title: "Chief Executive Officer", department: "Operations", level: "C-Level" },
];

async function upsertDepartment(c, { code, name, description }) {
  const res = await c.query(
    `INSERT INTO hris.departments (code, name, description, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           is_active = true,
           updated_at = NOW()
     RETURNING id`,
    [code, name, description]
  );
  return res.rows[0].id;
}

async function upsertEmploymentStatus(c, { code, name, color, description }) {
  await c.query(
    `INSERT INTO hris.employment_statuses (code, name, color, description, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           color = EXCLUDED.color,
           description = EXCLUDED.description,
           is_active = true,
           updated_at = NOW()`,
    [code, name, color, description]
  );
}

async function upsertPosition(c, { title, department, level }) {
  const existing = await c.query(
    `SELECT id FROM hris.positions WHERE title = $1 AND department = $2 LIMIT 1`,
    [title, department]
  );
  if (existing.rowCount) {
    await c.query(
      `UPDATE hris.positions
         SET level = $1, is_active = true
       WHERE id = $2`,
      [level, existing.rows[0].id]
    );
    return "updated";
  }
  await c.query(
    `INSERT INTO hris.positions (title, department, level, is_active)
     VALUES ($1, $2, $3, true)`,
    [title, department, level]
  );
  return "created";
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

    console.log("Seeding departments...");
    for (const dept of DEPARTMENTS) {
      await upsertDepartment(c, dept);
      console.log(`  ✓ ${dept.code} — ${dept.name}`);
    }

    console.log("\nSeeding employment statuses...");
    for (const status of EMPLOYMENT_STATUSES) {
      await upsertEmploymentStatus(c, status);
      console.log(`  ✓ ${status.code} — ${status.name}`);
    }

    console.log("\nSeeding positions...");
    let created = 0;
    let updated = 0;
    for (const pos of POSITIONS) {
      const result = await upsertPosition(c, pos);
      if (result === "created") created += 1;
      else updated += 1;
      console.log(`  ✓ ${pos.title} (${pos.department})`);
    }

    await c.query("COMMIT");

    console.log("\nHRIS master data selesai:");
    console.log(`  Departemen         : ${DEPARTMENTS.length}`);
    console.log(`  Status kepegawaian : ${EMPLOYMENT_STATUSES.length}`);
    console.log(`  Jabatan            : ${POSITIONS.length} (${created} baru, ${updated} diperbarui)`);
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
