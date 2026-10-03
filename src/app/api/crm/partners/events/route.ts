import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { crmOk, crmRoute } from "@/lib/crm/crm-route";

const UUID = /^[0-9a-f-]{36}$/i;
const STATUSES = ["pending", "processed", "unmatched", "failed", "ignored"];

/** GET — 200 event terbaru; filter partner_id & status. */
export const GET = crmRoute(IAM.crmPartners, "Gagal memuat event partner", async (_userId, request: NextRequest) => {
  const sp = request.nextUrl.searchParams;
  const partnerId = sp.get("partner_id");
  const status = sp.get("status");
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
    [partnerId && UUID.test(partnerId) ? partnerId : null, status && STATUSES.includes(status) ? status : null]
  );
  return crmOk(rows);
});
