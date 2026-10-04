import "server-only";
/** Pengelolaan partner loyalty dari dashboard: daftar, buat, ubah/rotasi secret, log event. */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { generatePartnerSecret, PARTNER_TYPES, PARTNER_XP_CAP } from "./partners";
import { hashSecret, PARTNER_PUBLIC_COLUMNS } from "./partners-server";

export const createPartnerSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,40}$/, "Kode 2–40 karakter: huruf, angka, - atau _"),
  name: z.string().trim().min(2).max(120),
  partner_type: z.enum(PARTNER_TYPES),
  awards_xp: z.boolean().default(false),
  xp_per_event: z.number().int().min(0).max(PARTNER_XP_CAP).default(0),
});

export const patchPartnerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  is_active: z.boolean().optional(),
  awards_xp: z.boolean().optional(),
  xp_per_event: z.number().int().min(0).max(PARTNER_XP_CAP).optional(),
  /** true = buat secret baru; secret lama langsung tidak berlaku. */
  rotate_secret: z.literal(true).optional(),
});

/** Partner + hitungan event per status. Secret tidak pernah dikirim. */
export async function listPartners() {
  const { rows } = await getPool().query(
    `SELECT ${PARTNER_PUBLIC_COLUMNS},
            count(e.id)::int AS event_count,
            count(e.id) FILTER (WHERE e.processing_status = 'processed')::int AS processed_count,
            count(e.id) FILTER (WHERE e.processing_status IN ('unmatched', 'failed'))::int AS pending_count,
            COALESCE(sum(e.xp_awarded), 0)::int AS xp_total,
            max(e.received_at) AS last_event_at
       FROM crm.crm_integration_partners p
       LEFT JOIN crm.crm_external_events e ON e.partner_id = p.id
      GROUP BY p.id
      ORDER BY p.name`
  );
  return rows;
}

/** Partner baru; secret dibuat server dan dikembalikan sekali. 409 bila kode sudah dipakai. */
export async function createPartner(body: z.infer<typeof createPartnerSchema>) {
  const secret = generatePartnerSecret();
  const { rows } = await getPool().query<{ id: string; code: string }>(
    `INSERT INTO crm.crm_integration_partners
       (code, name, partner_type, awards_xp, xp_per_event, signing_secret, secret_hash, secret_rotated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (code) DO NOTHING
     RETURNING id, code`,
    [body.code.toUpperCase(), body.name, body.partner_type, body.awards_xp, body.xp_per_event, secret, hashSecret(secret)]
  );
  if (!rows[0]) throw ApiError.conflict("Kode partner sudah dipakai");
  return { id: rows[0].id, code: rows[0].code, secret };
}

/** Ubah partner atau rotasi secret (secret baru dikembalikan sekali). */
export async function updatePartner(id: string, body: z.infer<typeof patchPartnerSchema>) {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (body.name !== undefined) add("name", body.name);
  if (body.is_active !== undefined) add("is_active", body.is_active);
  if (body.awards_xp !== undefined) add("awards_xp", body.awards_xp);
  if (body.xp_per_event !== undefined) add("xp_per_event", body.xp_per_event);
  const secret = body.rotate_secret ? generatePartnerSecret() : null;
  if (secret) {
    add("signing_secret", secret);
    add("secret_hash", hashSecret(secret));
    sets.push("secret_rotated_at = now()");
  }
  if (sets.length === 0) throw ApiError.badRequest("Tidak ada perubahan");

  const { rows } = await getPool().query(
    `UPDATE crm.crm_integration_partners SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
    values
  );
  if (!rows[0]) throw ApiError.notFound("Partner tidak ditemukan");
  return { id, secret };
}

const UUID = /^[0-9a-f-]{36}$/i;
const EVENT_STATUSES = ["pending", "processed", "unmatched", "failed", "ignored"];

/** 200 event terbaru; filter partner_id & status (nilai tak dikenal diabaikan). */
export async function listPartnerEvents(partnerId: string | null, status: string | null) {
  const { rows } = await getPool().query(
    `SELECT e.id, e.external_event_id, e.event_type, e.customer_identifier, e.processing_status AS status,
            e.xp_awarded, e.error_message, e.received_at, e.occurred_at, e.processed_at, e.payload,
            p.name AS partner_name, p.code AS partner_code,
            c.id AS customer_id, c.name AS member_name, c.phone AS member_phone
       FROM crm.crm_external_events e
       JOIN crm.crm_integration_partners p ON p.id = e.partner_id
       LEFT JOIN pos.pos_customers c ON c.id = e.customer_id
      WHERE ($1::uuid IS NULL OR e.partner_id = $1)
        AND ($2::text IS NULL OR e.processing_status = $2)
      ORDER BY e.received_at DESC
      LIMIT 200`,
    [partnerId && UUID.test(partnerId) ? partnerId : null, status && EVENT_STATUSES.includes(status) ? status : null]
  );
  return rows;
}
