import { z } from "zod";
import { getPool } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { samePhoneSql } from "@/lib/crm/campaigns-server";
import { MEMBER_READ_MENUS, resolveCustomerId } from "@/lib/crm/member-detail-server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Persetujuan komunikasi member: wa_consent (portal) dan opt-out marketing
 * (daftar STOP kampanye, per venue). Keduanya terpisah dan ditampilkan
 * berdampingan agar admin tidak salah membaca.
 */
async function loadConsent(customerId: string, branchId: string | null) {
  const { rows } = await getPool().query(
    `SELECT c.wa_consent, c.wa_verified_at, c.phone,
            o.id AS optout_id, o.source AS optout_source, o.note AS optout_note, o.created_at AS optout_at
       FROM pos.pos_customers c
       LEFT JOIN crm.crm_marketing_optouts o
              ON o.branch_id = $2
             AND ${samePhoneSql("o.phone", "c.phone")}
      WHERE c.id = $1`,
    [customerId, branchId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    wa_consent: row.wa_consent === true,
    wa_verified_at: row.wa_verified_at,
    marketing_opt_out: row.optout_id !== null,
    optout_source: row.optout_source,
    optout_note: row.optout_note,
    optout_at: row.optout_at,
  };
}

export const GET = crmRoute(MEMBER_READ_MENUS, "Gagal memuat persetujuan", async (_userId, _request: Request, { params }: Ctx) => {
  const customerId = await resolveCustomerId((await params).id);
  if (!customerId) return crmFail("Member tidak ditemukan", 404);
  const venue = await getCrmDefaultVenue(createPgClient());
  return crmOk(await loadConsent(customerId, venue.branchId));
});

const consentSchema = z.object({
  wa_consent: z.boolean().optional(),
  marketing_opt_out: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
});

export const PUT = crmRoute(MEMBER_READ_MENUS, "Gagal menyimpan persetujuan", async (userId, request: Request, { params }: Ctx) => {
  const customerId = await resolveCustomerId((await params).id);
  if (!customerId) return crmFail("Member tidak ditemukan", 404);
  const body = consentSchema.parse(await request.json());
  const pool = getPool();
  const venue = await getCrmDefaultVenue(createPgClient());

  if (body.wa_consent !== undefined) {
    await pool.query(`UPDATE pos.pos_customers SET wa_consent = $2, updated_at = now() WHERE id = $1`, [
      customerId,
      body.wa_consent,
    ]);
  }
  if (body.marketing_opt_out !== undefined) {
    if (!venue.companyId || !venue.branchId) return crmFail("Venue belum dikonfigurasi");
    const { rows } = await pool.query<{ phone: string }>(`SELECT phone FROM pos.pos_customers WHERE id = $1`, [customerId]);
    const phone = normalizePhoneDigits(rows[0]?.phone ?? "");
    if (!phone) return crmFail("Nomor member tidak valid untuk opt-out");
    if (body.marketing_opt_out) {
      await pool.query(
        `INSERT INTO crm.crm_marketing_optouts (company_id, branch_id, phone, customer_id, source, note, created_by)
         VALUES ($1, $2, $3, $4, 'manual', $5, $6)
         ON CONFLICT (branch_id, phone) DO NOTHING`,
        [venue.companyId, venue.branchId, phone, customerId, body.note || "Dari detail member", userId]
      );
    } else {
      await pool.query(
        `DELETE FROM crm.crm_marketing_optouts WHERE branch_id = $1 AND ${samePhoneSql("phone", "$2")}`,
        [venue.branchId, phone]
      );
    }
  }
  return crmOk(await loadConsent(customerId, venue.branchId), "Persetujuan disimpan");
});
