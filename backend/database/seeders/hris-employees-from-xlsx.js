#!/usr/bin/env node
/**
 * Seeder: karyawan dari file Excel format "Data Karyawan" (sheet pertama).
 *
 * File berisi NIK, NPWP dan nomor rekening, jadi tidak disimpan di repo:
 * path-nya wajib lewat --xlsx.
 *
 * Mengisi (idempoten, satu transaksi; baris dicocokkan lewat NIK lalu email):
 *   - hris.departments, hris.positions : dibuat bila belum ada
 *   - hris.employees                   : data pribadi, identitas, rekening
 *   - hris.employment_contracts        : kontrak PKWT aktif bila PKWT = Y
 *   - auth.users, configuration.users  : akun login (email Excel, role employee)
 *
 * Kolom tanpa tempat di hris.employees (tempat lahir, golongan darah, jenis dan
 * masa berlaku identitas, nama rekening) masuk ke catatan karyawan.
 *
 * Role employee hanya membuka menu ESS; HR menaikkan role di Manajemen User.
 * Password akun baru dari HRIS_SEED_PASSWORD (kosong = acak, dicetak sekali).
 * Akun yang sudah ada tidak disentuh, jadi menjalankan ulang tidak mengganti
 * password yang sudah diubah karyawan.
 *
 * Usage (dari backend/database):
 *   node seeders/hris-employees-from-xlsx.js --xlsx="/path/Data Karyawan.xlsx" --dry-run
 *   npm run db:seed:hris-employees -- --xlsx="/path/Data Karyawan.xlsx"
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed, seedPassword, passwordSource } = require("./lib/seed-password");

const ROOT = path.join(__dirname, "..", "..");
const LOGIN_ROLE = "employee";

const DEPARTMENTS = {
  FIN: "Finance & Accounting",
  HR: "Human Resources",
  MKT: "Marketing",
  OPS: "Operations",
  SLS: "Sales",
};

/** Salah ketik di file sumber. */
const TITLE_TYPOS = { mrketing: "marketing" };
const ACRONYMS = new Set(["FAT", "CRM", "HR", "HRD", "IT", "GA", "PT"]);
const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

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

function text(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function excelDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const iso = text(value).match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

function positionTitle(raw) {
  return text(raw)
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      const lower = TITLE_TYPOS[word.toLowerCase()] || word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function departmentCode(title) {
  const t = title.toLowerCase();
  if (/\b(fat|finance|account|tax|pajak)/.test(t)) return "FIN";
  if (/market|brand/.test(t)) return "MKT";
  if (/\b(crm|sales)/.test(t)) return "SLS";
  if (/\b(hr|hrd|human)/.test(t)) return "HR";
  return "OPS";
}

function positionLevel(title) {
  const t = title.toLowerCase();
  if (t.includes("manager")) return "Manager";
  if (t.includes("supervisor") || t.includes("spv")) return "Supervisor";
  return "Staff";
}

/** Baca dan validasi semua baris sebelum ada yang ditulis. */
function readEmployees(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
  const errors = [];
  const employees = [];
  rows.forEach((source, index) => {
    const row = {};
    for (const [k, v] of Object.entries(source)) row[text(k).replace(/\*$/, "")] = v;
    const fullName = text(row["Nama Lengkap"]);
    if (!fullName) return;

    const fail = (msg) => errors.push(`Baris ${index + 2} (${fullName}): ${msg}`);
    const ktp = text(row["Nomor Identitas"]);
    if (!/^\d{16}$/.test(ktp)) fail("Nomor Identitas harus 16 digit");
    const gender = { L: "male", P: "female" }[text(row["Jenis Kelamin"]).toUpperCase()];
    if (!gender) fail("Jenis Kelamin harus L atau P");
    const birthDate = excelDate(row["Tgl. Lahir"]);
    if (!birthDate) fail("Tgl. Lahir tidak terbaca");
    const joinDate = excelDate(row["Tgl. Awal Bekerja"]);
    if (!joinDate) fail("Tgl. Awal Bekerja tidak terbaca");
    const email = text(row["Email"]).toLowerCase();
    if (!email.includes("@")) fail("Email wajib diisi");
    const isPkwt = text(row["PKWT"]).toUpperCase() === "Y";
    const endDate = excelDate(row["Tgl. Akhir Kontrak"]);
    if (isPkwt && !endDate) fail("PKWT wajib punya Tgl. Akhir Kontrak");
    if (isPkwt && endDate && joinDate && endDate <= joinDate) fail("Tgl. Akhir Kontrak harus setelah Tgl. Awal Bekerja");

    const title = positionTitle(row["Jabatan"]) || "Staff";
    employees.push({
      fullName,
      ktp,
      gender,
      birthDate,
      joinDate,
      email,
      isPkwt,
      endDate: isPkwt ? endDate : null,
      title,
      departmentCode: departmentCode(title),
      npwp: text(row["NPWP"]) || null,
      phone: text(row["Handphone"]) || "-",
      address: text(row["Alamat"]) || null,
      bankName: text(row["Nama Bank"]) || null,
      bankAccount: text(row["No Rekening"]) || null,
      notes: [
        ["Tempat lahir", text(row["Tempat Lahir"])],
        ["Golongan darah", text(row["Golongan Darah"])],
        ["Kode negara", text(row["Kode Negara"])],
        ["Jenis identitas", text(row["Jenis Identitas"])],
        ["Masa berlaku identitas", text(row["Masa Berlaku Identitas"])],
        ["Nama rekening", text(row["Nama Rekening"])],
      ]
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    });
  });
  for (const key of ["ktp", "email"]) {
    const seen = new Set();
    for (const e of employees) {
      if (seen.has(e[key])) errors.push(`${e.fullName}: ${key} dobel di file`);
      seen.add(e[key]);
    }
  }
  if (errors.length) throw new Error(`File tidak valid:\n  ${errors.join("\n  ")}`);
  return employees;
}

async function ensureDepartment(c, code) {
  const { rows } = await c.query(
    `INSERT INTO hris.departments (code, name, is_active) VALUES ($1, $2, true)
     ON CONFLICT (code) DO UPDATE SET is_active = true
     RETURNING id, name`,
    [code, DEPARTMENTS[code]]
  );
  return rows[0];
}

async function ensurePosition(c, title, departmentName) {
  const { rows } = await c.query(
    `SELECT id FROM hris.positions WHERE lower(title) = lower($1) AND department = $2 LIMIT 1`,
    [title, departmentName]
  );
  if (rows[0]) return rows[0].id;
  const ins = await c.query(
    `INSERT INTO hris.positions (title, department, level, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
    [title, departmentName, positionLevel(title)]
  );
  return ins.rows[0].id;
}

/** NIP otomatis yang sama dengan aplikasi: EMP-<tahun>-NNNNN terkecil yang bebas. */
async function nextNip(c) {
  const year = new Date().getFullYear();
  const { rows } = await c.query(`SELECT nip FROM hris.employees WHERE nip LIKE $1`, [`EMP-${year}-%`]);
  const taken = new Set(rows.map((r) => r.nip));
  for (let seq = 1; ; seq++) {
    const nip = `EMP-${year}-${String(seq).padStart(5, "0")}`;
    if (!taken.has(nip)) return nip;
  }
}

async function upsertEmployee(c, e, departmentId, jobTitleId) {
  const values = [
    e.fullName, e.ktp, e.npwp, e.email, e.phone, e.birthDate, e.gender, e.address,
    e.joinDate, e.endDate, e.isPkwt ? "contract" : "permanent",
    departmentId, jobTitleId, e.bankName, e.bankAccount, e.notes,
  ];
  const { rows } = await c.query(
    `SELECT id FROM hris.employees WHERE ktp = $1 OR lower(email) = $2 ORDER BY (ktp = $1) DESC NULLS LAST LIMIT 1`,
    [e.ktp, e.email]
  );
  if (rows[0]) {
    await c.query(
      `UPDATE hris.employees SET full_name = $1, ktp = $2, npwp = $3, email = $4, phone = $5, birth_date = $6,
         gender = $7, address = $8, join_date = $9, end_date = $10, employment_status = $11, is_active = true,
         department_id = $12, job_title_id = $13, bank_name = $14, bank_account = $15, notes = $16, updated_at = now()
       WHERE id = $17`,
      [...values, rows[0].id]
    );
    return { id: rows[0].id, created: false };
  }
  const ins = await c.query(
    `INSERT INTO hris.employees (full_name, ktp, npwp, email, phone, birth_date, gender, address, join_date, end_date,
       employment_status, is_active, department_id, job_title_id, bank_name, bank_account, notes, nip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [...values, await nextNip(c)]
  );
  return { id: ins.rows[0].id, created: true };
}

/** Nomor kontrak sama dengan aplikasi: 0001/PKWT/XI/2026. */
async function nextContractNumber(c) {
  const now = new Date();
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM hris.employment_contracts
     WHERE contract_type = 'pkwt' AND date_part('year', created_at) = date_part('year', now())`
  );
  for (let seq = rows[0].n + 1; ; seq++) {
    const number = `${String(seq).padStart(4, "0")}/PKWT/${ROMAN_MONTHS[now.getMonth()]}/${now.getFullYear()}`;
    const taken = await c.query(`SELECT 1 FROM hris.employment_contracts WHERE contract_number = $1`, [number]);
    if (!taken.rowCount) return number;
  }
}

async function upsertContract(c, employeeId, e, departmentName) {
  const { rows } = await c.query(
    `SELECT id FROM hris.employment_contracts WHERE employee_id = $1 AND status = 'active' LIMIT 1`,
    [employeeId]
  );
  if (rows[0]) {
    await c.query(
      `UPDATE hris.employment_contracts SET contract_type = 'pkwt', start_date = $2, end_date = $3, probation_end_date = NULL,
         position_title = $4, department_name = $5 WHERE id = $1`,
      [rows[0].id, e.joinDate, e.endDate, e.title, departmentName]
    );
    return;
  }
  const number = await nextContractNumber(c);
  await c.query(
    `INSERT INTO hris.employment_contracts (employee_id, contract_number, contract_type, status, start_date, end_date,
       position_title, department_name, notes, created_by_name)
     VALUES ($1, $2, 'pkwt', 'active', $3, $4, $5, $6, 'Impor Data Karyawan', 'Seeder')`,
    [employeeId, number, e.joinDate, e.endDate, e.title, departmentName]
  );
  await c.query(
    `INSERT INTO hris.employment_history (employee_id, change_type, effective_date, new_employment_status, reason)
     VALUES ($1, 'contract_activated', $2, 'contract', $3)`,
    [employeeId, e.joinDate, `Kontrak ${number} (PKWT) aktif`]
  );
}

/** Akun login karyawan; null bila akun dengan email ini sudah ada. */
async function ensureLogin(c, employeeId, e, newPasswordHash) {
  const existing = await c.query(`SELECT id FROM auth.users WHERE lower(email) = $1`, [e.email]);
  let userId = existing.rows[0]?.id;
  const created = !userId;
  if (created) {
    const ins = await c.query(
      `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, now(), $3::jsonb, $4::jsonb) RETURNING id`,
      [e.email, await newPasswordHash(), JSON.stringify({ full_name: e.fullName }), JSON.stringify({ role: LOGIN_ROLE })]
    );
    userId = ins.rows[0].id;
    await c.query(
      `INSERT INTO configuration.users (id, full_name, role, email, status) VALUES ($1, $2, $3, $4, 'active')`,
      [userId, e.fullName, LOGIN_ROLE, e.email]
    );
    const role = await c.query(`SELECT id FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, [LOGIN_ROLE]);
    if (!role.rowCount) throw new Error(`Role ${LOGIN_ROLE} belum ada di iam.roles. Jalankan migrasi dulu.`);
    await c.query(`INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)`, [userId, role.rows[0].id]);
  }
  await c.query(`UPDATE hris.employees SET user_id = $1, is_access_app = true WHERE id = $2`, [userId, employeeId]);
  return created;
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const xlsxArg = process.argv.find((a) => a.startsWith("--xlsx="));
  if (!xlsxArg) throw new Error('Wajib: --xlsx="/path/Data Karyawan.xlsx"');
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set MIGRATE_DATABASE_URL / DATABASE_URL");
  assertLocalOrAllowed(url);

  const employees = readEmployees(xlsxArg.slice("--xlsx=".length));
  let passwordHash = null;
  const newPasswordHash = async () =>
    (passwordHash ??= await bcrypt.hash(dryRun ? "dry-run" : seedPassword("HRIS_SEED_PASSWORD"), 10));
  console.log(`${employees.length} karyawan di file.`);

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    // Trigger hris.employees memakai nama tabel tanpa schema.
    await c.query("SET LOCAL search_path TO hris, public, configuration, auth, iam");
    await c.query(
      `INSERT INTO hris.employment_statuses (code, name, color, description, is_active)
       VALUES ('contract', 'Kontrak', 'blue', 'Karyawan kontrak (PKWT)', true),
              ('permanent', 'Tetap', 'green', 'Karyawan tetap (PKWTT)', true)
       ON CONFLICT (code) DO NOTHING`
    );
    for (const e of employees) {
      const department = await ensureDepartment(c, e.departmentCode);
      const jobTitleId = await ensurePosition(c, e.title, department.name);
      const { id, created } = await upsertEmployee(c, e, department.id, jobTitleId);
      if (e.isPkwt) await upsertContract(c, id, e, department.name);
      const newLogin = await ensureLogin(c, id, e, newPasswordHash);
      console.log(
        `  ${created ? "+" : "~"} ${e.fullName} | ${e.title} | ${department.name} | ${e.isPkwt ? "PKWT" : "tetap"} | ${newLogin ? "login baru" : "login sudah ada"}`
      );
    }

    const others = await c.query(
      `SELECT nip, full_name FROM hris.employees WHERE ktp IS NULL OR ktp <> ALL($1::text[]) ORDER BY nip`,
      [employees.map((e) => e.ktp)]
    );
    if (others.rowCount) {
      console.log(`Karyawan lain yang tidak ada di file: ${others.rowCount}`);
      for (const o of others.rows) console.log(`  ${o.nip} | ${o.full_name}`);
    }
    await c.query(dryRun ? "ROLLBACK" : "COMMIT");
    console.log(dryRun ? "Dry run: tidak ada yang ditulis." : "Selesai.");
    if (passwordHash && !dryRun) console.log(`Password akun baru: ${passwordSource("HRIS_SEED_PASSWORD")}`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error("Gagal:", err.message);
  process.exit(1);
});
