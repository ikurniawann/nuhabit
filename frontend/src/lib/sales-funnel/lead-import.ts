import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { syncLeadAccountContact } from "./account-sync";
import { normalizeLeadSpreadsheetHeader, parseLeadSpreadsheetFile } from "./lead-spreadsheet";
import {
  LEAD_ORG_TYPES,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  isValidNormalizedPhone,
  normalizePhone,
  type SalesFunnelUser,
} from "./server";

const MAX_ROWS = 500;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export interface LeadImportRow {
  org_name: string;
  org_type: string;
  pic_name: string;
  pic_title: string | null;
  pic_phone: string;
  pic_email: string | null;
  city: string | null;
  source: string;
  temperature: string;
  notes: string | null;
}

export type LeadImportRowResult =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "ok"; lead: LeadImportRow; rawPhone: string; warning: string | null };

function pickEnum(value: string | undefined, allowed: readonly string[], fallback: string): string {
  const raw = value?.trim().toLowerCase();
  return raw && allowed.includes(raw) ? raw : fallback;
}

/** Kunci duplikat = instansi + no. WA (satu PIC boleh banyak leads). */
export function leadDedupKey(phone: string, orgName: string): string {
  return `${phone}|${orgName.trim().toLowerCase()}`;
}

/**
 * Satu baris spreadsheet (header sudah dinormalisasi) → data lead. Email
 * tidak valid tidak menggagalkan baris: diabaikan dan dicatat sebagai warning.
 */
export function mapLeadImportRow(headers: string[], cells: string[]): LeadImportRowResult {
  const row: Record<string, string> = {};
  headers.forEach((header, idx) => {
    row[header] = cells[idx] || "";
  });
  if (Object.values(row).every((v) => !v.trim())) return { kind: "empty" };

  const orgName = row.nama_instansi?.trim();
  const picName = row.nama_pic?.trim();
  const picPhoneRaw = row.wa_pic?.trim();
  if (!orgName || !picName || !picPhoneRaw) {
    return { kind: "invalid", message: "Field wajib kosong: nama_instansi / nama_pic / wa_pic" };
  }
  const phone = normalizePhone(picPhoneRaw);
  if (!isValidNormalizedPhone(phone)) {
    return { kind: "invalid", message: `No. WA tidak valid: ${picPhoneRaw}` };
  }
  const emailRaw = row.email_pic?.trim() || "";
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw.slice(0, 150) : null;
  return {
    kind: "ok",
    rawPhone: picPhoneRaw,
    warning: emailRaw && !email ? `Email diabaikan (tidak valid): ${emailRaw}` : null,
    lead: {
      org_name: orgName,
      org_type: pickEnum(row.jenis_instansi, LEAD_ORG_TYPES, "corporate"),
      pic_name: picName,
      pic_title: row.jabatan_pic?.trim() || null,
      pic_phone: phone,
      pic_email: email,
      city: row.kota?.trim() || null,
      source: pickEnum(row.sumber, LEAD_SOURCES, "lainnya"),
      temperature: pickEnum(row.suhu, LEAD_TEMPERATURES, "hangat"),
      notes: row.catatan?.trim() || null,
    },
  };
}

export interface LeadImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

/** Import CSV/XLSX leads ke venue; baris gagal dilewati dan dilaporkan per nomor baris. */
export async function importLeads(
  user: SalesFunnelUser,
  venue: { companyId: string; branchId: string },
  file: { buffer: Buffer; name: string }
): Promise<LeadImportResult> {
  const rows = await parseLeadSpreadsheetFile(file.buffer, file.name);
  if (rows.length < 2) {
    throw ApiError.badRequest("File harus berisi baris header dan minimal satu baris data");
  }
  if (rows.length - 1 > MAX_ROWS) throw ApiError.badRequest(`Maksimal ${MAX_ROWS} baris per import`);

  const headers = rows[0].map(normalizeLeadSpreadsheetHeader);
  const existingRows = await query<{ pic_phone: string; org_name: string }>(
    `SELECT pic_phone, org_name FROM crm.crm_sales_leads
     WHERE company_id = $1 AND deleted_at IS NULL`,
    [venue.companyId]
  );
  const usedKeys = new Set(existingRows.map((r) => leadDedupKey(r.pic_phone, r.org_name)));

  let imported = 0;
  let skipped = 0;
  const errors: LeadImportResult["errors"] = [];
  const skip = (row: number, message: string) => {
    errors.push({ row, message });
    skipped += 1;
  };

  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const result = mapLeadImportRow(headers, rows[i]);
    if (result.kind === "empty") continue;
    if (result.kind === "invalid") {
      skip(rowNumber, result.message);
      continue;
    }
    const { lead, rawPhone, warning } = result;
    const key = leadDedupKey(lead.pic_phone, lead.org_name);
    if (usedKeys.has(key)) {
      skip(rowNumber, `Duplikat instansi + no. WA: ${lead.org_name} / ${rawPhone}`);
      continue;
    }
    if (warning) errors.push({ row: rowNumber, message: warning });

    try {
      await queryOne(
        `INSERT INTO crm.crm_sales_leads
           (company_id, branch_id, org_name, org_type, pic_name, pic_title,
            pic_phone, pic_email, city, source, temperature, notes,
            owner_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          venue.companyId,
          venue.branchId,
          lead.org_name,
          lead.org_type,
          lead.pic_name,
          lead.pic_title,
          lead.pic_phone,
          lead.pic_email,
          lead.city,
          lead.source,
          lead.temperature,
          lead.notes,
          user.role === "sales" ? user.id : null,
          user.id,
        ]
      );
      usedKeys.add(key);
      imported += 1;
    } catch (insertErr) {
      console.error("[sales-funnel] import row error:", insertErr);
      skip(rowNumber, "Gagal menyimpan baris");
    }
  }

  // EPIC-050: tautkan lead hasil import ke Account/Contact (upsert by nama/nomor WA)
  if (imported > 0) {
    try {
      const untied = await query<{ id: string }>(
        `SELECT id FROM crm.crm_sales_leads
         WHERE company_id = $1 AND deleted_at IS NULL
           AND (account_id IS NULL OR contact_id IS NULL)
         ORDER BY created_at DESC LIMIT 1000`,
        [venue.companyId]
      );
      for (const lead of untied) await syncLeadAccountContact(lead.id);
    } catch (e) {
      console.error("[sales-funnel] sync account/contact import gagal:", e);
    }
  }
  return { imported, skipped, errors };
}
