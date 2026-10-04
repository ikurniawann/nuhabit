import "server-only";
/** Sub-halaman detail member: aktivitas, persetujuan komunikasi, badge. */
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { createPgClient } from "@/lib/pg/create-client";
import { samePhoneSql } from "./campaigns-server";
import { getCrmDefaultVenue } from "./server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Id di URL detail member bisa berupa id profil CRM, id customer POS, atau
 * "pos-<customerId>" (customer belum punya profil). Kembalikan id customer;
 * 404 bila member tidak ada.
 */
export async function requireMemberCustomerId(idParam: string): Promise<string> {
  const id = idParam.startsWith("pos-") ? idParam.slice(4) : idParam;
  const { rows } = UUID.test(id)
    ? await getPool().query<{ customer_id: string }>(
        `SELECT customer_id FROM crm.crm_member_profiles WHERE id = $1 OR customer_id = $1
         UNION ALL
         SELECT id FROM pos.pos_customers WHERE id = $1
         LIMIT 1`,
        [id]
      )
    : { rows: [] };
  const customerId = rows[0]?.customer_id;
  if (!customerId) throw ApiError.notFound("Member tidak ditemukan");
  return customerId;
}

export const MEMBER_ACTIVITY_TABS = ["checkins", "bookings", "challenges", "notifications", "wallet"] as const;
export type MemberActivityTab = (typeof MEMBER_ACTIVITY_TABS)[number];

const ACTIVITY_SQL: Record<MemberActivityTab, string> = {
  checkins: `SELECT k.id, k.decision, k.reason, k.created_at, u.full_name AS cashier_name
               FROM crm.member_checkins k
               LEFT JOIN configuration.users u ON u.id = k.scanned_by
              WHERE k.customer_id = $1 ORDER BY k.created_at DESC LIMIT 100`,
  bookings: `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.created_at, b.cancelled_at,
                    e.id AS event_id, e.title, e.starts_at, e.location, e.price_idr::float AS price_idr
               FROM crm.event_bookings b JOIN crm.events e ON e.id = b.event_id
              WHERE b.customer_id = $1 ORDER BY e.starts_at DESC LIMIT 100`,
  challenges: `SELECT c.id, c.title, c.metric, c.target::float AS target, c.starts_at, c.ends_at,
                      c.reward_xp, c.reward_ark_idr::float AS reward_ark_idr, j.joined_at, j.rewarded_at
                 FROM crm.challenge_joins j JOIN crm.challenges c ON c.id = j.challenge_id
                WHERE j.customer_id = $1 ORDER BY j.joined_at DESC LIMIT 100`,
  notifications: `SELECT n.id, n.type, n.title, n.body, n.created_at, n.read_at, n.opened_at, n.clicked_at,
                         k.name AS campaign_name
                    FROM crm.member_notifications n
                    LEFT JOIN crm.crm_campaigns k ON k.id = n.campaign_id
                   WHERE n.customer_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
  wallet: `SELECT w.id, w.type, w.amount::float AS amount, w.ark_coins::float AS ark_coins,
                  w.balance_after::float AS balance_after, w.status, w.notes, w.payment_method, w.created_at
             FROM pos.pos_wallet_transactions w
            WHERE w.customer_id = $1 ORDER BY w.created_at DESC LIMIT 100`,
};

export async function loadMemberActivity(customerId: string, tab: MemberActivityTab): Promise<unknown[]> {
  const { rows } = await getPool().query(ACTIVITY_SQL[tab], [customerId]);
  return rows;
}

// ── Persetujuan komunikasi ─────────────────────────────────────────────────

/**
 * Persetujuan komunikasi member: wa_consent (portal) dan opt-out marketing
 * (daftar STOP kampanye, per venue). Keduanya terpisah dan ditampilkan
 * berdampingan agar admin tidak salah membaca.
 */
async function readConsent(customerId: string, branchId: string | null) {
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

export async function loadMemberConsent(customerId: string) {
  const venue = await getCrmDefaultVenue(createPgClient());
  return readConsent(customerId, venue.branchId);
}

export async function updateMemberConsent(
  customerId: string,
  body: { wa_consent?: boolean; marketing_opt_out?: boolean; note?: string },
  actorId: string
) {
  const pool = getPool();
  const venue = await getCrmDefaultVenue(createPgClient());

  if (body.wa_consent !== undefined) {
    await pool.query(`UPDATE pos.pos_customers SET wa_consent = $2, updated_at = now() WHERE id = $1`, [
      customerId,
      body.wa_consent,
    ]);
  }
  if (body.marketing_opt_out !== undefined) {
    if (!venue.companyId || !venue.branchId) throw ApiError.badRequest("Venue belum dikonfigurasi");
    const { rows } = await pool.query<{ phone: string }>(`SELECT phone FROM pos.pos_customers WHERE id = $1`, [customerId]);
    const phone = normalizePhoneDigits(rows[0]?.phone ?? "");
    if (!phone) throw ApiError.badRequest("Nomor member tidak valid untuk opt-out");
    if (body.marketing_opt_out) {
      await pool.query(
        `INSERT INTO crm.crm_marketing_optouts (company_id, branch_id, phone, customer_id, source, note, created_by)
         VALUES ($1, $2, $3, $4, 'manual', $5, $6)
         ON CONFLICT (branch_id, phone) DO NOTHING`,
        [venue.companyId, venue.branchId, phone, customerId, body.note || "Dari detail member", actorId]
      );
    } else {
      await pool.query(
        `DELETE FROM crm.crm_marketing_optouts WHERE branch_id = $1 AND ${samePhoneSql("phone", "$2")}`,
        [venue.branchId, phone]
      );
    }
  }
  return readConsent(customerId, venue.branchId);
}

// ── Badge ──────────────────────────────────────────────────────────────────

/** Semua badge aktif (plus yang dimiliki) dengan status dimiliki/dicabut untuk member. */
export async function listMemberBadges(customerId: string) {
  const { rows } = await getPool().query(
    `SELECT b.id, b.code, b.name, b.image_url, b.metric, b.threshold::float AS threshold,
            b.min_lifetime_xp, b.bonus_xp, b.is_active,
            mb.awarded_at, mb.source, rv.revoked_at, rv.reason AS revoke_reason
       FROM crm.crm_badges b
       LEFT JOIN crm.crm_member_badges mb ON mb.badge_id = b.id AND mb.customer_id = $1
       LEFT JOIN crm.crm_member_badge_revocations rv ON rv.badge_id = b.id AND rv.customer_id = $1
      WHERE b.is_active OR mb.id IS NOT NULL
      ORDER BY (mb.id IS NULL), b.name`,
    [customerId]
  );
  return rows;
}
