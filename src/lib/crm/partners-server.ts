import "server-only";
import { createHash } from "crypto";
import { getPool } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { awardPartnerEventXp } from "./loyalty-engine";
import { getCrmDefaultVenue } from "./server";
import { decideEvent, matchSubject, partnerChannel, phoneTail, type MatchCandidate } from "./partners";

/**
 * Sisi server partner loyalty: simpan event (selalu, walau member belum
 * dikenal), cocokkan member, beri XP bila partner dipercaya, dan cocokkan
 * ulang event yang tertunda.
 */

export interface PartnerRow {
  id: string;
  code: string;
  name: string;
  partner_type: string;
  is_active: boolean;
  awards_xp: boolean;
  xp_per_event: number;
  signing_secret: string | null;
}

export const PARTNER_PUBLIC_COLUMNS = `p.id, p.code, p.name, p.partner_type, p.is_active, p.awards_xp,
  p.xp_per_event, p.secret_rotated_at, p.created_at, p.updated_at,
  (p.signing_secret IS NOT NULL) AS has_secret`;

/** Hash secret untuk kolom lama secret_hash (identifikasi, bukan verifikasi). */
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

export async function findPartnerByCode(code: string): Promise<PartnerRow | null> {
  const { rows } = await getPool().query<PartnerRow>(
    `SELECT id, code, name, partner_type, is_active, awards_xp, xp_per_event, signing_secret
       FROM crm.crm_integration_partners WHERE code = $1`,
    [code.trim().toUpperCase()]
  );
  return rows[0] ?? null;
}

/** Member yang dimaksud partner (email/telepon), atau null bila tak pasti. */
export async function findMemberForSubject(subject: string | null): Promise<string | null> {
  const value = subject?.trim() ?? "";
  if (!value) return null;
  const { rows } = await getPool().query<MatchCandidate>(
    `SELECT id AS "customerId", email, phone FROM pos.pos_customers
      WHERE is_active IS DISTINCT FROM false
        AND (lower(email) = lower($1)
             OR ($2::text IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 8) = $2))
      LIMIT 10`,
    [value, phoneTail(value)]
  );
  return matchSubject(value, rows);
}

export interface SettledEvent {
  id: string;
  status: string;
  customer_id: string | null;
  xp_awarded: number;
}

/**
 * Cocokkan & proses satu event. `customerId` diisi = pencocokan manual oleh
 * admin. XP idempoten per event (ledger), jadi memproses ulang aman.
 */
export async function settleEvent(
  eventId: string,
  opts: { customerId?: string; actorId?: string } = {}
): Promise<SettledEvent | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT e.id, e.event_type, e.customer_identifier, p.name AS partner_name, p.partner_type,
            p.is_active, p.awards_xp, p.xp_per_event
       FROM crm.crm_external_events e
       JOIN crm.crm_integration_partners p ON p.id = e.partner_id
      WHERE e.id = $1`,
    [eventId]
  );
  const event = rows[0];
  if (!event) return null;

  const customerId = opts.customerId ?? (await findMemberForSubject(event.customer_identifier));
  const decision = decideEvent(
    { is_active: event.is_active, awards_xp: event.awards_xp, xp_per_event: Number(event.xp_per_event) },
    customerId !== null
  );

  let status: string = decision.status;
  let xpAwarded = 0;
  let ledgerId: string | null = null;
  let errorMessage: string | null = null;
  if (customerId && decision.xp > 0) {
    try {
      const db = createPgClient();
      const venue = await getCrmDefaultVenue(db);
      const result = await awardPartnerEventXp(db, {
        customerId,
        eventId,
        sourceChannel: partnerChannel(event.partner_type).ledgerChannel,
        description: `${event.partner_name}: ${event.event_type}`,
        xpAmount: decision.xp,
        companyId: venue.companyId,
        branchId: venue.branchId,
      });
      if (result.status === "posted") {
        xpAwarded = result.xpAwarded;
        ledgerId = result.ledgerIds?.[0] ?? null;
      }
    } catch (error) {
      status = "failed";
      errorMessage = (error as Error).message.slice(0, 300);
    }
  }

  const { rows: updated } = await pool.query<SettledEvent>(
    `UPDATE crm.crm_external_events
        SET customer_id = $2,
            member_id = (SELECT id FROM crm.crm_member_profiles WHERE customer_id = $2),
            processing_status = $3,
            xp_awarded = CASE WHEN $4::int > 0 THEN $4 ELSE xp_awarded END,
            xp_ledger_id = COALESCE($5, xp_ledger_id),
            error_message = $6,
            matched_by = COALESCE($7, matched_by),
            processed_at = now()
      WHERE id = $1
      RETURNING id, processing_status AS status, customer_id, xp_awarded`,
    [eventId, customerId, status, xpAwarded, ledgerId, errorMessage, opts.actorId ?? null]
  );
  return updated[0] ?? null;
}

export interface IncomingEvent {
  externalId: string;
  eventType: string;
  subject: string | null;
  occurredAt: string | null;
  payload: Record<string, unknown>;
}

/**
 * Simpan event lebih dulu dan selalu: event tanpa member tetap fakta yang
 * dikirim partner. Partner mengirim ulang = event yang sama (idempoten per
 * external id), tidak ada XP kedua.
 */
export async function ingestPartnerEvent(
  partner: PartnerRow,
  input: IncomingEvent
): Promise<{ event: SettledEvent; duplicate: boolean }> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO crm.crm_external_events
       (partner_id, external_event_id, source_channel, event_type, customer_identifier, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (partner_id, external_event_id) DO NOTHING
     RETURNING id`,
    [
      partner.id,
      input.externalId,
      partnerChannel(partner.partner_type).eventChannel,
      input.eventType,
      input.subject,
      input.occurredAt,
      JSON.stringify(input.payload),
    ]
  );
  if (!rows[0]) {
    const { rows: existing } = await pool.query<SettledEvent>(
      `SELECT id, processing_status AS status, customer_id, xp_awarded
         FROM crm.crm_external_events WHERE partner_id = $1 AND external_event_id = $2`,
      [partner.id, input.externalId]
    );
    return { event: existing[0], duplicate: true };
  }
  const event = await settleEvent(rows[0].id);
  return { event: event!, duplicate: false };
}

/** Cocokkan ulang semua event unmatched/failed (opsional per partner). */
export async function rematchPendingEvents(partnerId: string | null): Promise<{ checked: number; matched: number }> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM crm.crm_external_events
      WHERE processing_status IN ('unmatched', 'failed', 'pending')
        AND ($1::uuid IS NULL OR partner_id = $1)
      ORDER BY received_at
      LIMIT 500`,
    [partnerId]
  );
  let matched = 0;
  for (const row of rows) {
    const settled = await settleEvent(row.id);
    if (settled?.status === "processed") matched += 1;
  }
  return { checked: rows.length, matched };
}
