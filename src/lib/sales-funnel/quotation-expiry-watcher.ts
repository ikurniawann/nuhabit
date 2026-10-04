/**
 * EPIC-050 T-3.4 — pengingat quotation mendekati kedaluwarsa (valid_until ≤ 3 hari)
 * ke penanggung jawab deal: WA + in-app, sekali per quotation (expiry_reminded_at).
 */
import { getPool } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { notifyUsers } from "@/lib/crm/workflow-engine";
import { isValidNormalizedPhone, normalizePhone } from "./server";

const CHECK_INTERVAL_MS = 60 * 60_000; // tiap jam
const DAYS_BEFORE = 3;
let started = false;

export async function sendQuotationExpiryReminders(): Promise<number> {
  const pool = getPool();
  const claimed = await pool.query<{
    id: string; quote_number: string; valid_until: string; total: string; deal_id: string; deal_title: string;
    org_name: string; owner_user_id: string | null; owner_phone: string | null;
  }>(
    `UPDATE crm.crm_sales_quotations q SET expiry_reminded_at = now()
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     WHERE q.deal_id = d.id AND q.deleted_at IS NULL AND q.expiry_reminded_at IS NULL
       AND q.status IN ('draft', 'terkirim') AND q.valid_until IS NOT NULL
       AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
     RETURNING q.id, q.quote_number, q.valid_until::text AS valid_until, q.total, d.id AS deal_id, d.title AS deal_title,
               l.org_name, d.owner_user_id,
               (SELECT e.phone FROM hris.employees e WHERE e.user_id = u.id AND e.phone IS NOT NULL ORDER BY e.created_at DESC LIMIT 1) AS owner_phone`,
    [DAYS_BEFORE]
  );
  if (claimed.rows.length === 0) return 0;
  const config = await loadGatewayConfig();
  let n = 0;
  for (const q of claimed.rows) {
    const due = formatDate(q.valid_until);
    const text = `Quotation ${q.quote_number} (${q.org_name} · ${q.deal_title}) berlaku sampai ${due}. Follow-up PIC atau buat revisi.`;
    if (q.owner_user_id) {
      await notifyUsers([q.owner_user_id], `Quotation ${q.quote_number} segera kedaluwarsa`, text, `/dashboard/sales-funnel/pipeline?deal=${q.deal_id}`, { quotation_id: q.id });
    }
    const phone = q.owner_phone ? normalizePhone(q.owner_phone) : "";
    if (config && isValidNormalizedPhone(phone)) {
      await sendGatewayText(config, { target: phone, message: `⏳ *Quotation segera kedaluwarsa*\n\n${text}` }).catch((e) => console.error("[quotation-expiry] WA gagal:", e));
    }
    n += 1;
  }
  console.log(`[quotation-expiry] ${n} pengingat dikirim`);
  return n;
}

export function startQuotationExpiryWatcher(): void {
  if (started) return;
  started = true;
  const tick = () => { sendQuotationExpiryReminders().catch((e) => console.error("[quotation-expiry] gagal:", e)); };
  setTimeout(tick, 60_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
