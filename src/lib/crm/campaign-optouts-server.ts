import "server-only";
/**
 * EPIC-033 — daftar opt-out marketing per venue. Kelola manual (MVP); keyword
 * STOP otomatis = Fase D. TERPISAH dari wa_consent portal.
 */
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { campaignVenue } from "./campaigns-admin-server";

export async function listOptouts() {
  const venue = await campaignVenue();
  return query(
    `SELECT id, phone, source, note, created_at
     FROM crm.crm_marketing_optouts
     WHERE branch_id = $1
     ORDER BY created_at DESC LIMIT 500`,
    [venue.branchId]
  );
}

export async function addOptout(rawPhone: string, note: string | null, userId: string) {
  const phone = normalizePhoneDigits(rawPhone);
  if (!phone) throw ApiError.badRequest("Nomor tidak valid");
  const venue = await campaignVenue();
  const rows = await query<{ id: string }>(
    `INSERT INTO crm.crm_marketing_optouts
       (company_id, branch_id, phone, source, note, created_by)
     VALUES ($1, $2, $3, 'manual', $4, $5)
     ON CONFLICT (branch_id, phone) DO UPDATE SET
       note = COALESCE(EXCLUDED.note, crm_marketing_optouts.note)
     RETURNING id`,
    [venue.companyId, venue.branchId, phone, note, userId]
  );
  return rows[0];
}

export async function removeOptout(id: string): Promise<void> {
  const venue = await campaignVenue();
  const rows = await query<{ id: string }>(
    `DELETE FROM crm.crm_marketing_optouts
     WHERE id = $1 AND branch_id = $2 RETURNING id`,
    [id, venue.branchId]
  );
  if (rows.length === 0) throw ApiError.notFound("Tidak ditemukan");
}
