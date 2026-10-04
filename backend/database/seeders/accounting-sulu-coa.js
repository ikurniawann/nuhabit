#!/usr/bin/env node
/**
 * Seeder: accounting Chart of Accounts from docs/data/SULU - COA .xlsx
 *
 * Idempotent upsert by (company_id, code). Default: global template (company_id NULL).
 *
 * Usage:
 *   node database/seeders/accounting-sulu-coa.js
 *   node database/seeders/accounting-sulu-coa.js --company=SULU
 *   npm run db:seed:accounting-sulu-coa
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const XLSX = require("xlsx");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_XLSX = path.join(ROOT, "..", "docs", "data", "SULU - COA .xlsx");

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
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function normalizeAccountCode(raw) {
  const trimmed = String(raw || "")
    .trim()
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ");
  if (!trimmed) return null;
  const spaced = trimmed.match(/^(\d)\s+(\d)\s+(\d{2})\s+(\d{3})$/);
  if (spaced) return `${spaced[1]}${spaced[2]}${spaced[3]}${spaced[4]}`;
  const digits = trimmed.replace(/\s+/g, "");
  if (/^\d\d\d{2}\d{3}$/.test(digits)) return digits;
  return null;
}

function inferLevel(code) {
  const m = code.match(/^(\d)(\d)(\d{2})(\d{3})$/);
  if (!m) return null;
  const [, , b, cc, ddd] = m;
  if (b === "0" && cc === "00" && ddd === "000") return 1;
  if (cc === "00" && ddd === "000") return 2;
  if (ddd === "000") return 3;
  return 4;
}

function idealParent(code) {
  const level = inferLevel(code);
  const m = code.match(/^(\d)(\d)(\d{2})(\d{3})$/);
  if (!m || !level || level === 1) return null;
  const [, a, b, cc] = m;
  if (level === 2) return `${a}000000`;
  if (level === 3) return `${a}${b}00000`;
  return `${a}${b}${cc}000`;
}

function resolveParent(code, existing) {
  let parent = idealParent(code);
  while (parent) {
    if (existing.has(parent)) return parent;
    parent = idealParent(parent);
  }
  return null;
}

function inferType(code) {
  const d = code[0];
  if (d === "1") return "ASSET";
  if (d === "2") return "LIABILITY";
  if (d === "3") return "EQUITY";
  if (d === "4") return "REVENUE";
  if (d === "5") return "COGS";
  if (d === "6" || d === "7") return "EXPENSE";
  if (d === "8") return code[1] === "2" ? "OTHER_INCOME" : "OTHER_EXPENSE";
  return "EXPENSE";
}

function inferCashFlow(code, name, level) {
  if (level < 4 && !/DEPRECIATION/i.test(name)) return null;
  const upper = name.toUpperCase();
  if (/DEPRECIATION|\bDE\b/.test(upper) || code.startsWith("81")) return "NON_CASH";
  if (code.startsWith("11") || code.startsWith("12") || code.startsWith("13"))
    return "OPERATING";
  if (code.startsWith("21")) return "OPERATING";
  if (code.startsWith("16") || code.startsWith("17")) return "INVESTING";
  if (code.startsWith("22") || code.startsWith("3")) return "FINANCING";
  if (code.startsWith("4") || code.startsWith("5") || code.startsWith("6"))
    return "OPERATING";
  if (code.startsWith("82") || code.startsWith("83")) return "OPERATING";
  return null;
}

function parseSuluSheet(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath);
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "coa") || wb.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  const staged = [];
  const seen = new Map();

  matrix.forEach((row, idx) => {
    const rawCode = String(row[0] || "").trim();
    if (!rawCode) return;
    let code = normalizeAccountCode(rawCode);
    if (!code) {
      console.warn(`  skip row ${idx + 1}: invalid code ${rawCode}`);
      return;
    }
    const name = [row[1], row[2], row[3], row[4], row[5], row[6]]
      .map((v) => String(v || "").trim())
      .find((v) => v.length > 0);
    if (!name) {
      console.warn(`  skip row ${idx + 1}: empty name (${code})`);
      return;
    }
    if (code === "8301001" && /rounding gain/i.test(name)) {
      code = "8201003";
      console.log(`  remap Rounding Gain → 8201003`);
    }
    if (seen.has(code)) {
      console.warn(`  skip row ${idx + 1}: duplicate ${code}`);
      return;
    }
    seen.set(code, true);
    staged.push({ code, name });
  });

  const codes = new Set(staged.map((r) => r.code));
  return staged.map((r) => {
    const level = inferLevel(r.code);
    return {
      ...r,
      level,
      parent_code: resolveParent(r.code, codes),
      account_type_code: inferType(r.code),
      is_contra: /ACCUMULAT|ALLOWANCE FOR|CONTRA/i.test(r.name),
      is_cash_bank:
        level === 4 &&
        (r.code.startsWith("1101") || r.code.startsWith("1102")),
      cash_flow_category: inferCashFlow(r.code, r.name, level),
    };
  });
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }
  assertLocalTarget(url);

  const xlsxPath = argValue("--file=") || DEFAULT_XLSX;
  const companyCode = argValue("--company=");

  if (!fs.existsSync(xlsxPath)) {
    console.error(`ERROR: File not found: ${xlsxPath}`);
    process.exit(1);
  }

  console.log(`Parsing ${xlsxPath}...`);
  const accounts = parseSuluSheet(xlsxPath);
  console.log(`  ${accounts.length} accounts`);

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();
  await client.query(
    "SET search_path TO public, iam, configuration, hris, performance, recruitment, item, purchasing, inventory, manufacturing, pos, crm, accounting, auth"
  );

  try {
    let companyId = null;
    if (companyCode) {
      const { rows } = await client.query(
        `SELECT id FROM configuration.companies
         WHERE upper(code) = upper($1)
         LIMIT 1`,
        [companyCode]
      );
      if (!rows[0]) {
        throw new Error(`Company code not found: ${companyCode}`);
      }
      companyId = rows[0].id;
      console.log(`Target company: ${companyCode} (${companyId})`);
    } else {
      console.log("Target: global template (company_id NULL)");
    }

    const { rows: types } = await client.query(
      `SELECT id, code FROM accounting.account_types WHERE is_active = true`
    );
    const typeMap = new Map(types.map((t) => [t.code, t.id]));

    await client.query("BEGIN");

    const idByCode = new Map();
    const ordered = [...accounts].sort(
      (a, b) => a.level - b.level || a.code.localeCompare(b.code)
    );

    let upserted = 0;
    for (const row of ordered) {
      const typeId = typeMap.get(row.account_type_code);
      if (!typeId) throw new Error(`Missing account type ${row.account_type_code}`);

      let parentId = null;
      if (row.parent_code) {
        parentId = idByCode.get(row.parent_code) || null;
        if (!parentId) {
          const { rows: parents } = await client.query(
            companyId
              ? `SELECT id FROM accounting.chart_of_accounts
                 WHERE code = $1 AND company_id = $2 AND deleted_at IS NULL`
              : `SELECT id FROM accounting.chart_of_accounts
                 WHERE code = $1 AND company_id IS NULL AND deleted_at IS NULL`,
            companyId ? [row.parent_code, companyId] : [row.parent_code]
          );
          parentId = parents[0]?.id || null;
        }
        if (!parentId) {
          throw new Error(`Parent ${row.parent_code} missing for ${row.code}`);
        }
      }

      const { rows: upsertedRows } = await client.query(
        companyId
          ? `INSERT INTO accounting.chart_of_accounts (
               company_id, code, name, parent_id, account_type_id, level,
               is_postable, is_contra, is_cash_bank, cash_flow_category, is_active
             ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,true)
             ON CONFLICT (company_id, code) WHERE deleted_at IS NULL AND company_id IS NOT NULL
             DO UPDATE SET
               name = EXCLUDED.name,
               parent_id = EXCLUDED.parent_id,
               account_type_id = EXCLUDED.account_type_id,
               level = EXCLUDED.level,
               is_contra = EXCLUDED.is_contra,
               is_cash_bank = EXCLUDED.is_cash_bank,
               cash_flow_category = EXCLUDED.cash_flow_category,
               is_active = true,
               deleted_at = NULL,
               updated_at = now()
             RETURNING id`
          : `INSERT INTO accounting.chart_of_accounts (
               company_id, code, name, parent_id, account_type_id, level,
               is_postable, is_contra, is_cash_bank, cash_flow_category, is_active
             ) VALUES (NULL,$1,$2,$3,$4,$5,true,$6,$7,$8,true)
             ON CONFLICT (code) WHERE deleted_at IS NULL AND company_id IS NULL
             DO UPDATE SET
               name = EXCLUDED.name,
               parent_id = EXCLUDED.parent_id,
               account_type_id = EXCLUDED.account_type_id,
               level = EXCLUDED.level,
               is_contra = EXCLUDED.is_contra,
               is_cash_bank = EXCLUDED.is_cash_bank,
               cash_flow_category = EXCLUDED.cash_flow_category,
               is_active = true,
               deleted_at = NULL,
               updated_at = now()
             RETURNING id`,
        companyId
          ? [
              companyId,
              row.code,
              row.name,
              parentId,
              typeId,
              row.level,
              row.is_contra,
              row.is_cash_bank,
              row.cash_flow_category,
            ]
          : [
              row.code,
              row.name,
              parentId,
              typeId,
              row.level,
              row.is_contra,
              row.is_cash_bank,
              row.cash_flow_category,
            ]
      );

      idByCode.set(row.code, upsertedRows[0].id);
      upserted += 1;
    }

    await client.query(
      `UPDATE accounting.chart_of_accounts coa
       SET is_postable = NOT EXISTS (
             SELECT 1 FROM accounting.chart_of_accounts child
             WHERE child.parent_id = coa.id AND child.deleted_at IS NULL
           ),
           updated_at = now()
       WHERE coa.deleted_at IS NULL
         AND (
           ($1::uuid IS NULL AND coa.company_id IS NULL)
           OR coa.company_id = $1
         )`,
      [companyId]
    );

    await client.query("COMMIT");
    console.log(`Done. Upserted ${upserted} accounts.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
