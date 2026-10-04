#!/usr/bin/env node
/**
 * Reset HRIS + seed Master Data dari docs/DATABASE - SULU IN WONDERLAND EMPLOYEE.xlsx
 *
 * - Hapus auth.users kecuali keep-list
 * - Wipe data operasional HRIS + employees
 * - Upsert departments / positions dari sheet Master Data
 * - Insert karyawan + akun app (login = email Excel, password HRIS_SEED_PASSWORD;
 *   kosong = satu password acak untuk semua akun, dicetak sekali)
 * - Role by jabatan: Cashier→pos; Head Bar/SPV/Captain/CDP/Demi→pos_supervisor; else→employee
 *
 * Safety: default hanya Postgres lokal (localhost / 127.0.0.1).
 * Remote (mis. server-sulu) butuh --allow-remote; apply destruktif butuh
 * --confirm-remote-wipe juga.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/db-dev-arkiv \
 *     npm run db:seed:hris-from-xlsx
 *   … -- --dry-run
 *
 *   # remote server-sulu (dari .env):
 *   npm run db:seed:hris-from-xlsx -- --allow-remote --dry-run
 *   npm run db:seed:hris-from-xlsx -- --allow-remote --confirm-remote-wipe
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { Client } = require("pg");
const {
  sslForUrl,
  assertLocalTarget,
  isLocalDatabaseUrl,
  parseHost,
} = require("../scripts/pg-utils");
const { seedPassword, passwordSource } = require("./lib/seed-password");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_XLSX = path.join(
  ROOT,
  "docs",
  "DATABASE - SULU IN WONDERLAND EMPLOYEE.xlsx"
);
const KEEP_EMAILS = [
  "super@arkivworld.com",
  "agus@wit.id",
  "agussugiman@gmail.com",
];
const HOLDING_CODE = "PROLOGE";
const COMPANY_CODE = "SULU";
const BRANCH_CODE = "SULU-DAGO";

const MONTHS_ID = {
  januari: 1,
  februari: 2,
  maret: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  agustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

const DEPT_META = {
  Bar: { code: "BAR", name: "Bar" },
  Cashier: { code: "CSH", name: "Cashier" },
  Kitchen: { code: "KIT", name: "Kitchen" },
  Service: { code: "SVC", name: "Service" },
  "Back Office": { code: "BO", name: "Back Office" },
};

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

function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function formatKtp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const asInt = Math.round(value);
    return String(asInt);
  }
  const digits = String(value).replace(/\D/g, "");
  return digits || null;
}

function excelDateToIso(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${mm}-${dd}`;
  }
  const text = normalizeText(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** Parse "3 Agustus - 2 September 2026" → join date ISO (start). */
function parseProbationStart(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const m = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s*[-–]\s*.+?(\d{4})\s*$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS_ID[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function positionLevel(title) {
  const t = normalizeKey(title);
  if (t.includes("head") || t.includes("manager") || t.includes("ops")) return "Manager";
  if (
    t.includes("spv") ||
    t.includes("supervisor") ||
    t.includes("captain") ||
    t.includes("cdp") ||
    t.includes("demi")
  ) {
    return "Supervisor";
  }
  return "Staff";
}

/** Plan role mapping by jabatan. */
function roleForPosition(title) {
  const t = normalizeKey(title);
  if (t.includes("cashier")) return "pos";
  if (t === "hrd" || t.includes("hrd") || t.includes("human resource")) return "hrd";
  if (
    t.includes("head bar") ||
    t.includes("spv floor") ||
    t.includes("supervisor floor") ||
    t === "captain" ||
    t.startsWith("cdp") ||
    t.includes("demi chef")
  ) {
    return "pos_supervisor";
  }
  return "employee";
}

/** Split "Captain + Supervisor Floor" into candidate titles to resolve manager. */
function reportTitleCandidates(reportTo) {
  const raw = normalizeText(reportTo);
  if (!raw) return [];
  const parts = raw.split(/\s*\+\s*/).map((p) => normalizeText(p)).filter(Boolean);
  const aliases = [];
  for (const part of parts) {
    aliases.push(part);
    const key = normalizeKey(part);
    if (key === "supervisor floor" || key === "spv floor") {
      aliases.push("SPV Floor", "Supervisor Floor");
    }
    if (key === "ops manager" || key === "operational manager") {
      aliases.push("Ops Manager", "Operational Manager", "Operations Manager");
    }
    if (key === "cdp pastry") aliases.push("CDP Kitchen / Pastry", "Commis Pastry");
    if (key === "cdp kitchen") aliases.push("CDP Kitchen", "CDP Kitchen / Pastry");
  }
  // Prefer supervisor titles before captain when both listed
  const preferred = [];
  const rest = [];
  for (const a of aliases) {
    const k = normalizeKey(a);
    if (k.includes("spv") || k.includes("supervisor") || k.includes("ops") || k.includes("head")) {
      preferred.push(a);
    } else {
      rest.push(a);
    }
  }
  const seen = new Set();
  const out = [];
  for (const a of [...preferred, ...rest]) {
    const k = normalizeKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function readMasterData(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel tidak ditemukan: ${xlsxPath}`);
  }
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = wb.SheetNames.find((n) => normalizeKey(n) === "master data");
  if (!sheetName) {
    throw new Error(`Sheet "Master Data" tidak ada. Sheets: ${wb.SheetNames.join(", ")}`);
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: true });
  const employees = [];
  for (const row of rows) {
    const fullName = normalizeText(row["Nama Lengkap"]);
    if (!fullName) continue;
    let email = normalizeText(row["Email"]).toLowerCase();
    if (!email) {
      throw new Error(`Email kosong untuk ${fullName}`);
    }
    if (email.endsWith(".con")) {
      const fixed = `${email.slice(0, -4)}.com`;
      console.warn(`Email typo dikoreksi: ${email} → ${fixed} (${fullName})`);
      email = fixed;
    }
    const department = normalizeText(row["Departement"] || row["Department"]);
    const position = normalizeText(row["Posisi Saat Ini"]);
    if (!department || !position) {
      throw new Error(`Department/posisi kosong untuk ${fullName}`);
    }
    const joinDate = parseProbationStart(row["Durasi Probation"]) || new Date().toISOString().slice(0, 10);
    const notesPayload = {
      nickname: normalizeText(row["Nama Panggilan"]) || null,
      birth_place: normalizeText(row["Tempat Lahir"]) || null,
      domicile: normalizeText(row["Alamat Domisili saat ini"]) || null,
      work_experience: normalizeText(row["Pengalaman Bekerja"]) || null,
      probation: normalizeText(row["Durasi Probation"]) || null,
      cv: normalizeText(row["CV"]) || null,
      loi: normalizeText(row["LOI / Surat Offering Letter"]) || null,
      report_to_label: normalizeText(row["Report Kepada"]) || null,
    };
    employees.push({
      department,
      position,
      reportTo: normalizeText(row["Report Kepada"]),
      fullName,
      phone: normalizeText(row["Nomor HP aktif"]) || "-",
      email,
      birthDate: excelDateToIso(row["Tanggal Lahir"]),
      address: normalizeText(row["Alamat sesuai KTP"]) || null,
      ktp: formatKtp(row["Nomor KTP"]),
      joinDate,
      notes: JSON.stringify(notesPayload),
      role: roleForPosition(position),
    });
  }
  return employees;
}

async function ensureRoleCheckAllowsEmployee(client) {
  await client.query(`
    ALTER TABLE configuration.users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE configuration.users
      ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
        'super_admin'::text, 'admin'::text, 'hrd'::text, 'hiring_manager'::text, 'direksi'::text,
        'purchasing_admin'::text, 'purchasing_manager'::text, 'purchasing_staff'::text,
        'finance_staff'::text, 'warehouse_staff'::text, 'warehouse_admin'::text,
        'pos'::text, 'pos_supervisor'::text, 'qc_staff'::text,
        'employee'::text, 'sales'::text, 'marketing'::text
      ]));
  `);
}

async function resolveBusinessScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id, c.id AS company_id, b.id AS branch_id,
            h.name AS holding_name, c.name AS company_name, b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c ON c.holding_id = h.id AND c.code = $2
     JOIN configuration.branches b ON b.company_id = c.id AND b.code = $3
     WHERE h.code = $1`,
    [HOLDING_CODE, COMPANY_CODE, BRANCH_CODE]
  );
  return rows[0] ?? null;
}

async function nullifyAuditUserRefs(client, doomedIds) {
  if (!doomedIds.length) return;
  const tables = [
    ["inventory.finished_goods_inventory", ["created_by", "updated_by"]],
    ["item.products", ["created_by", "updated_by", "deleted_by"]],
    ["item.raw_materials", ["created_by", "updated_by", "deleted_by"]],
    ["item.units", ["created_by", "updated_by", "deleted_by"]],
    ["manufacturing.production_batches", ["created_by"]],
    ["manufacturing.production_orders", ["created_by", "updated_by"]],
    ["purchasing.purchase_orders", ["cancelled_by", "sent_by"]],
    ["purchasing.supplier_price_lists", ["created_by", "updated_by", "deleted_by"]],
    ["purchasing.suppliers", ["created_by", "updated_by", "deleted_by"]],
    ["purchasing.vendor_price_lists", ["created_by", "updated_by", "deleted_by"]],
  ];
  for (const [table, cols] of tables) {
    const exists = await client.query(`SELECT to_regclass($1) AS r`, [table]);
    if (!exists.rows[0]?.r) continue;
    for (const col of cols) {
      await client.query(
        `UPDATE ${table} SET ${col} = NULL WHERE ${col} = ANY($1::uuid[])`,
        [doomedIds]
      );
    }
  }
}

async function wipeNonKeepUsers(client, dryRun) {
  const keep = KEEP_EMAILS.map((e) => e.toLowerCase());
  const { rows } = await client.query(
    `SELECT id, email FROM auth.users WHERE lower(email) <> ALL($1::text[])`,
    [keep]
  );
  console.log(`Users to delete: ${rows.length}`);
  if (dryRun) {
    rows.slice(0, 10).forEach((r) => console.log("  -", r.email));
    if (rows.length > 10) console.log(`  … +${rows.length - 10} more`);
    return rows;
  }
  const ids = rows.map((r) => r.id);
  await nullifyAuditUserRefs(client, ids);
  if (ids.length) {
    await client.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [ids]);
  }
  return rows;
}

async function wipeHrisEmployees(client, dryRun) {
  const statements = [
    `DELETE FROM performance.feedback_assignments`,
    `DELETE FROM performance.feedback_summaries`,
    `DELETE FROM performance.feedback_cycles`,
    `DELETE FROM performance.behavioral_review_items`,
    `DELETE FROM performance.behavioral_assessments`,
    `DELETE FROM performance.performance_reviews`,
    `DELETE FROM performance.kpi_scorecards`,
    `DELETE FROM performance.kpi_snapshots`,
    `DELETE FROM performance.kpi_targets`,
    `UPDATE recruitment.candidates SET promoted_to_employee_id = NULL WHERE promoted_to_employee_id IS NOT NULL`,
    `DELETE FROM ticketing.ticket_staff_passes`,
    `DELETE FROM hris.payroll_details`,
    `DELETE FROM hris.payroll_runs`,
    `DELETE FROM hris.leaves`,
    `DELETE FROM hris.leave_balances`,
    `DELETE FROM hris.loans`,
    `DELETE FROM hris.overtime_requests`,
    `DELETE FROM hris.onboarding_checklists`,
    `DELETE FROM hris.offboarding_checklists`,
    `DELETE FROM hris.attendance`,
    `DELETE FROM hris.employee_shifts`,
    `DELETE FROM hris.employee_schedules`,
    `DELETE FROM hris.employee_salary`,
    `DELETE FROM hris.employee_benefits`,
    `DELETE FROM hris.employee_documents`,
    `DELETE FROM hris.employee_kpis`,
    `DELETE FROM hris.employment_contracts`,
    `DELETE FROM hris.employment_history`,
    `DELETE FROM hris.ess_module_reads`,
    `DELETE FROM hris.project_assignments`,
    `DELETE FROM hris.development_plans`,
    `DELETE FROM hris.announcement_reads`,
    `DELETE FROM hris.announcement_departments`,
    `DELETE FROM hris.announcements`,
    `UPDATE hris.employees SET reporting_to = NULL`,
    `DELETE FROM hris.employees`,
  ];

  if (dryRun) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM hris.employees`);
    console.log(`Would wipe HRIS employees (${rows[0].n} rows) + dependent tables`);
    return;
  }

  for (const sql of statements) {
    const sp = `sp_wipe_${Math.random().toString(36).slice(2, 8)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await client.query(sql);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      if (/does not exist/i.test(err.message)) {
        console.warn("  skip:", sql.slice(0, 72), "→", err.message);
        continue;
      }
      throw err;
    }
  }
}

async function upsertDepartment(client, deptName) {
  const meta = DEPT_META[deptName] || {
    code: normalizeText(deptName).slice(0, 3).toUpperCase().padEnd(3, "X"),
    name: deptName,
  };
  const res = await client.query(
    `INSERT INTO hris.departments (code, name, description, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, is_active = true, updated_at = NOW()
     RETURNING id`,
    [meta.code, meta.name, `Imported from Master Data (${meta.name})`]
  );
  return res.rows[0].id;
}

async function upsertPosition(client, title, departmentName) {
  const level = positionLevel(title);
  const existing = await client.query(
    `SELECT id FROM hris.positions WHERE title = $1 AND department = $2 LIMIT 1`,
    [title, departmentName]
  );
  if (existing.rowCount) {
    await client.query(
      `UPDATE hris.positions SET level = $1, is_active = true WHERE id = $2`,
      [level, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const ins = await client.query(
    `INSERT INTO hris.positions (title, department, level, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [title, departmentName, level]
  );
  return ins.rows[0].id;
}

async function ensureEmploymentStatuses(client) {
  const statuses = [
    { code: "probation", name: "Probasi", color: "yellow" },
    { code: "contract", name: "Kontrak", color: "blue" },
    { code: "permanent", name: "Tetap", color: "green" },
    { code: "internship", name: "Magang", color: "purple" },
    { code: "resigned", name: "Resign", color: "red" },
    { code: "terminated", name: "PHK", color: "red" },
    { code: "suspended", name: "Suspend", color: "orange" },
  ];
  for (const s of statuses) {
    await client.query(
      `INSERT INTO hris.employment_statuses (code, name, color, description, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, color = EXCLUDED.color, is_active = true, updated_at = NOW()`,
      [s.code, s.name, s.color, s.name]
    );
  }
}

async function insertEmployee(client, row, departmentId, jobTitleId) {
  // NIP: trigger may auto-fill empty; provide unique placeholder if trigger requires non-null before
  const nip = `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ins = await client.query(
    `INSERT INTO hris.employees (
       full_name, nip, email, phone, birth_date, address, ktp,
       join_date, employment_status, is_active, is_access_app,
       department_id, job_title_id, notes
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::date, 'probation', true, true,
       $9, $10, $11
     )
     RETURNING id, nip`,
    [
      row.fullName,
      nip,
      row.email,
      row.phone,
      row.birthDate,
      row.address,
      row.ktp,
      row.joinDate,
      departmentId,
      jobTitleId,
      row.notes,
    ]
  );
  return ins.rows[0];
}

async function provisionUser(client, { email, fullName, role, employeeId, scope, passwordHash }) {
  const userMeta = JSON.stringify({ role, full_name: fullName });
  const appMeta = JSON.stringify({ role });

  const existing = await client.query(
    `SELECT id FROM auth.users WHERE lower(email) = lower($1)`,
    [email]
  );
  let userId;
  if (existing.rowCount) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE auth.users
         SET password_hash = $1, email_verified_at = NOW(),
             raw_user_meta_data = $2::jsonb, raw_app_meta_data = $3::jsonb,
             banned_until = NULL
       WHERE id = $4`,
      [passwordHash, userMeta, appMeta, userId]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, NOW(), $3::jsonb, $4::jsonb)
       RETURNING id`,
      [email, passwordHash, userMeta, appMeta]
    );
    userId = ins.rows[0].id;
  }

  await client.query(
    `INSERT INTO configuration.users (
       id, full_name, role, email, status,
       business_scope, holding_id, company_id, branch_id
     ) VALUES ($1, $2, $3, $4, 'active', 'branch', $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           email = EXCLUDED.email,
           status = 'active',
           business_scope = 'branch',
           holding_id = EXCLUDED.holding_id,
           company_id = EXCLUDED.company_id,
           branch_id = EXCLUDED.branch_id,
           updated_at = NOW()`,
    [userId, fullName, role, email, scope.holding_id, scope.company_id, scope.branch_id]
  );

  // Prefer IAM role by code when present (fallback menus via role code)
  const iamRole = await client.query(
    `SELECT id FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
    [role]
  );
  if (iamRole.rowCount) {
    await client.query(`DELETE FROM iam.user_roles WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO iam.user_roles (user_id, role_id, is_primary)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
      [userId, iamRole.rows[0].id]
    );
  }

  await client.query(
    `UPDATE hris.employees
       SET user_id = $1, is_access_app = true, is_active = true, updated_at = NOW()
     WHERE id = $2`,
    [userId, employeeId]
  );

  return userId;
}

async function ensureKeepEmployees(client, scope, passwordHash) {
  for (const email of KEEP_EMAILS) {
    const auth = await client.query(
      `SELECT id, email, raw_app_meta_data->>'role' AS role FROM auth.users WHERE lower(email) = lower($1)`,
      [email]
    );
    if (!auth.rowCount) {
      console.warn(`Keep user missing in auth.users: ${email} (skip recreate — jalankan super-admin seeder bila perlu)`);
      continue;
    }
    const userId = auth.rows[0].id;
    const profile = await client.query(`SELECT full_name, role FROM configuration.users WHERE id = $1`, [userId]);
    const fullName = profile.rows[0]?.full_name || email.split("@")[0];
    const role = profile.rows[0]?.role || auth.rows[0].role || "super_admin";

    const emp = await client.query(
      `SELECT id FROM hris.employees WHERE user_id = $1 OR lower(email) = lower($2) LIMIT 1`,
      [userId, email]
    );
    let employeeId;
    if (emp.rowCount) {
      employeeId = emp.rows[0].id;
      await client.query(
        `UPDATE hris.employees
           SET user_id = $1, full_name = $2, email = $3, is_active = true, is_access_app = true, updated_at = NOW()
         WHERE id = $4`,
        [userId, fullName, email, employeeId]
      );
    } else {
      const nip = email.startsWith("super@") ? "SUPERADMIN" : "AGUSWIT";
      const ins = await client.query(
        `INSERT INTO hris.employees
           (user_id, full_name, nip, email, phone, join_date, employment_status, is_active, is_access_app)
         VALUES ($1, $2, $3, $4, '-', CURRENT_DATE, 'permanent', true, true)
         RETURNING id`,
        [userId, fullName, nip, email]
      );
      employeeId = ins.rows[0].id;
    }

    // Keep scope: super_admin unscoped; agus follows branch if profile says so
    if (role === "super_admin") {
      await client.query(
        `UPDATE configuration.users
           SET status = 'active', business_scope = NULL, holding_id = NULL, company_id = NULL, branch_id = NULL, updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
    } else if (scope) {
      await client.query(
        `UPDATE configuration.users
           SET status = 'active',
               business_scope = COALESCE(business_scope, 'branch'),
               holding_id = COALESCE(holding_id, $2),
               company_id = COALESCE(company_id, $3),
               branch_id = COALESCE(branch_id, $4),
               updated_at = NOW()
         WHERE id = $1`,
        [userId, scope.holding_id, scope.company_id, scope.branch_id]
      );
    }

    console.log(`Keep linked: ${email} → employee ${employeeId} (${role})`);
  }
}

function databaseNameFromUrl(url) {
  try {
    const normalized = url.replace(/^postgresql:/i, "http:");
    const pathname = new URL(normalized).pathname || "";
    return pathname.replace(/^\//, "") || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const allowRemote =
    process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_DB === "1";
  const confirmRemoteWipe =
    process.argv.includes("--confirm-remote-wipe") ||
    process.env.CONFIRM_REMOTE_HRIS_RESET === "YES";
  const xlsxArg = process.argv.find((a) => a.startsWith("--xlsx="));
  const xlsxPath = xlsxArg ? xlsxArg.slice("--xlsx=".length) : DEFAULT_XLSX;

  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }

  const host = parseHost(url);
  const dbName = databaseNameFromUrl(url);
  const isRemote = !isLocalDatabaseUrl(url);

  if (isRemote) {
    if (!allowRemote) {
      console.error(
        `REFUSED: target remote (${host}/${dbName}). Tambahkan --allow-remote untuk melanjutkan.`
      );
      console.error(
        "Contoh dry-run:\n  npm run db:seed:hris-from-xlsx -- --allow-remote --dry-run"
      );
      console.error(
        "Contoh apply:\n  npm run db:seed:hris-from-xlsx -- --allow-remote --confirm-remote-wipe"
      );
      process.exit(1);
    }
    if (!dryRun && !confirmRemoteWipe) {
      console.error(
        `REFUSED: apply destruktif ke remote ${host}/${dbName} butuh --confirm-remote-wipe (atau CONFIRM_REMOTE_HRIS_RESET=YES).`
      );
      console.error("Jalankan --dry-run dulu, lalu apply dengan kedua flag.");
      process.exit(1);
    }
    console.warn("╔══════════════════════════════════════════════════════════╗");
    console.warn("║  WARNING: REMOTE DATABASE TARGET                         ║");
    console.warn(`║  host=${host}  db=${dbName}`.padEnd(61) + "║");
    console.warn(`║  mode=${dryRun ? "dry-run" : "DESTRUCTIVE APPLY"}`.padEnd(61) + "║");
    console.warn("╚══════════════════════════════════════════════════════════╝");
  } else {
    try {
      assertLocalTarget(url, "MIGRATE_DATABASE_URL");
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const keepSet = new Set(KEEP_EMAILS.map((e) => e.toLowerCase()));
  const master = readMasterData(xlsxPath).filter((row) => {
    if (!keepSet.has(row.email)) return true;
    console.warn(`Skip Excel row (keep account): ${row.email}`);
    return false;
  });
  console.log(`Target: ${host}/${dbName}${isRemote ? " (remote)" : " (local)"}`);
  console.log(`Master Data rows: ${master.length}`);
  console.log(
    `Password akun: ${process.env.HRIS_SEED_PASSWORD ? "dari HRIS_SEED_PASSWORD" : "acak, dicetak saat apply"}`
  );
  console.log(`Keep emails: ${KEEP_EMAILS.join(", ")}`);
  if (dryRun) {
    console.log("\n— DRY RUN — sample mapping:");
    for (const row of master.slice(0, 8)) {
      console.log(`  ${row.fullName} | ${row.department}/${row.position} → ${row.role} | ${row.email}`);
    }
    if (master.length > 8) console.log(`  … +${master.length - 8} more`);
  }

  const roleCounts = master.reduce((acc, r) => {
    acc[r.role] = (acc[r.role] || 0) + 1;
    return acc;
  }, {});
  console.log("Role counts:", roleCounts);

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();

  try {
    if (!dryRun) await client.query("BEGIN");

    await client.query(`
      SET search_path TO
        hris, public, configuration, auth, iam,
        performance, recruitment, ticketing, item,
        inventory, purchasing, manufacturing, pos
    `);

    const scope = await resolveBusinessScope(client);
    if (!scope) {
      throw new Error(
        `Business scope ${HOLDING_CODE}/${COMPANY_CODE}/${BRANCH_CODE} tidak ditemukan. Jalankan db:seed:business-hierarchy dulu.`
      );
    }
    console.log(`Scope: ${scope.holding_name} → ${scope.company_name} → ${scope.branch_name}`);

    await wipeNonKeepUsers(client, dryRun);
    await wipeHrisEmployees(client, dryRun);

    if (dryRun) {
      console.log("\nDry-run selesai (tidak ada write).");
      return;
    }

    await ensureRoleCheckAllowsEmployee(client);
    await ensureEmploymentStatuses(client);

    const deptIds = new Map();
    const positionIds = new Map(); // key: title|dept
    for (const row of master) {
      if (!deptIds.has(row.department)) {
        deptIds.set(row.department, await upsertDepartment(client, row.department));
      }
      const pKey = `${row.position}|${row.department}`;
      if (!positionIds.has(pKey)) {
        positionIds.set(pKey, await upsertPosition(client, row.position, row.department));
      }
    }
    console.log(`Departments upserted: ${deptIds.size}, positions: ${positionIds.size}`);

    const passwordHash = await bcrypt.hash(seedPassword("HRIS_SEED_PASSWORD"), 10);
    const created = [];

    for (const row of master) {
      const departmentId = deptIds.get(row.department);
      const jobTitleId = positionIds.get(`${row.position}|${row.department}`);
      const emp = await insertEmployee(client, row, departmentId, jobTitleId);
      const userId = await provisionUser(client, {
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        employeeId: emp.id,
        scope,
        passwordHash,
      });
      created.push({
        employeeId: emp.id,
        nip: emp.nip,
        email: row.email,
        fullName: row.fullName,
        position: row.position,
        reportTo: row.reportTo,
        role: row.role,
        userId,
      });
      console.log(`+ ${row.fullName} (${row.position}) → ${row.role}`);
    }

    // Resolve reporting_to by position title among created employees
    const byTitle = new Map();
    for (const c of created) {
      const key = normalizeKey(c.position);
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(c);
    }

    let linked = 0;
    for (const c of created) {
      const candidates = reportTitleCandidates(c.reportTo);
      let managerId = null;
      for (const title of candidates) {
        const list = byTitle.get(normalizeKey(title)) || [];
        const mgr = list.find((m) => m.employeeId !== c.employeeId);
        if (mgr) {
          managerId = mgr.employeeId;
          break;
        }
      }
      if (managerId) {
        await client.query(`UPDATE hris.employees SET reporting_to = $1 WHERE id = $2`, [
          managerId,
          c.employeeId,
        ]);
        linked += 1;
      }
    }
    console.log(`reporting_to linked: ${linked}/${created.length}`);

    await ensureKeepEmployees(client, scope, passwordHash);

    await client.query("COMMIT");

    const counts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM hris.employees) AS employees,
        (SELECT count(*)::int FROM auth.users) AS users,
        (SELECT count(*)::int FROM configuration.users WHERE role = 'pos') AS role_pos,
        (SELECT count(*)::int FROM configuration.users WHERE role = 'pos_supervisor') AS role_pos_supervisor,
        (SELECT count(*)::int FROM configuration.users WHERE role = 'employee') AS role_employee
    `);
    console.log("\nSelesai.");
    console.log("Counts:", counts.rows[0]);
    console.log(`Login sample: ${created[0]?.email} (password ${passwordSource("HRIS_SEED_PASSWORD")})`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
