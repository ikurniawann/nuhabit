import { z } from "zod";
import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { generatePartnerSecret, PARTNER_TYPES, PARTNER_XP_CAP } from "@/lib/crm/partners";
import { hashSecret, PARTNER_PUBLIC_COLUMNS } from "@/lib/crm/partners-server";

/** GET — partner + hitungan event per status. Secret tidak pernah dikirim. */
export const GET = crmRoute(IAM.crmPartners, "Gagal memuat partner", async () => {
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
  return crmOk(rows);
});

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,40}$/, "Kode 2–40 karakter: huruf, angka, - atau _"),
  name: z.string().trim().min(2).max(120),
  partner_type: z.enum(PARTNER_TYPES),
  awards_xp: z.boolean().default(false),
  xp_per_event: z.number().int().min(0).max(PARTNER_XP_CAP).default(0),
});

/** POST — partner baru; secret dibuat server dan ditampilkan sekali di respons. */
export const POST = crmRoute(IAM.crmPartners, "Gagal membuat partner", async (_userId, request: Request) => {
  const body = createSchema.parse(await request.json());
  const secret = generatePartnerSecret();
  const { rows } = await getPool().query(
    `INSERT INTO crm.crm_integration_partners
       (code, name, partner_type, awards_xp, xp_per_event, signing_secret, secret_hash, secret_rotated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (code) DO NOTHING
     RETURNING id, code`,
    [body.code.toUpperCase(), body.name, body.partner_type, body.awards_xp, body.xp_per_event, secret, hashSecret(secret)]
  );
  if (!rows[0]) return crmFail("Kode partner sudah dipakai", 409);
  return crmOk({ id: rows[0].id, code: rows[0].code, secret }, "Partner dibuat");
});
