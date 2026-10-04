import "server-only";
/**
 * EPIC-050 Fase 2 (T-2.2) — lead scoring, sisi server: muat aturan, kumpulkan
 * sinyal (snapshot + hitungan event), tulis leads.score. Dipanggil dari event
 * bus (setiap event yang menyentuh lead) dan endpoint "hitung ulang semua".
 */
import { query, queryOne } from "@/lib/db";
import {
  computeLeadScore,
  eventCountKey,
  type EventCounts,
  type LeadScoringSnapshot,
  type ScoringRule,
} from "./scoring";

export async function loadScoringRules(companyId: string | null): Promise<ScoringRule[]> {
  return query<ScoringRule>(
    `SELECT id, name, kind, field, operator, value, event_type, window_days, max_count, points
     FROM crm.crm_scoring_rules
     WHERE is_active AND (company_id IS NULL OR company_id = $1)
     ORDER BY sort_order, created_at`,
    [companyId]
  );
}

type LeadRow = {
  id: string;
  company_id: string;
  source: string;
  org_type: string;
  temperature: string;
  status: string;
  city: string | null;
  pic_email: string | null;
  pic_title: string | null;
  pic_phone: string;
  account_type: string | null;
  industry: string | null;
  score: number;
};

/** Hitung kejadian yang relevan untuk aturan event (hanya kunci yang dibutuhkan aturan). */
async function gatherEventCounts(lead: LeadRow, rules: ScoringRule[]): Promise<EventCounts> {
  const counts: EventCounts = {};
  const eventRules = rules.filter((r) => r.kind === "event" && r.event_type);
  if (eventRules.length === 0) return counts;

  const needs = new Set(eventRules.map((r) => r.event_type as string));
  const maxWindow = (type: string) => {
    const windows = eventRules.filter((r) => r.event_type === type).map((r) => r.window_days);
    return windows.some((w) => !w) ? null : Math.max(...windows.map((w) => w as number));
  };

  if (needs.has("task_done")) {
    const w = maxWindow("task_done");
    const rows = await query<{ activity_type: string; n: string }>(
      `SELECT a.activity_type, count(*) AS n
       FROM crm.crm_sales_activities a
       WHERE a.deleted_at IS NULL AND a.status = 'done'
         AND (a.lead_id = $1
              OR (a.subject_type = 'lead' AND a.subject_id = $1)
              OR a.deal_id IN (SELECT id FROM crm.crm_sales_deals WHERE lead_id = $1 AND deleted_at IS NULL))
         ${w ? `AND COALESCE(a.done_at, a.updated_at) >= now() - ($2::int * interval '1 day')` : ""}
       GROUP BY a.activity_type`,
      w ? [lead.id, w] : [lead.id]
    );
    let total = 0;
    for (const row of rows) {
      counts[`task_done:${row.activity_type}`] = Number(row.n);
      total += Number(row.n);
    }
    counts.task_done = total;
  }
  if (needs.has("wa_inbound")) {
    const w = maxWindow("wa_inbound");
    const suffix = lead.pic_phone.replace(/[^0-9]/g, "").slice(-9);
    if (suffix.length >= 9) {
      const row = await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM crm.wa_messages m
         WHERE m.direction = 'inbound'
           AND right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 9) = $1
           ${w ? `AND m.created_at >= now() - ($2::int * interval '1 day')` : ""}`,
        w ? [suffix, w] : [suffix]
      );
      counts.wa_inbound = Number(row?.n ?? 0);
    }
  }
  if (needs.has("deal_created")) {
    const w = maxWindow("deal_created");
    const row = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM crm.crm_sales_deals d
       WHERE d.lead_id = $1 AND d.deleted_at IS NULL
         ${w ? `AND d.created_at >= now() - ($2::int * interval '1 day')` : ""}`,
      w ? [lead.id, w] : [lead.id]
    );
    counts.deal_created = Number(row?.n ?? 0);
  }
  if (needs.has("quotation_sent")) {
    const w = maxWindow("quotation_sent");
    const row = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       WHERE d.lead_id = $1 AND q.deleted_at IS NULL AND q.status IN ('terkirim', 'diterima')
         ${w ? `AND q.updated_at >= now() - ($2::int * interval '1 day')` : ""}`,
      w ? [lead.id, w] : [lead.id]
    );
    counts.quotation_sent = Number(row?.n ?? 0);
  }
  // pastikan kunci sub-jenis yang diminta aturan ada (0 bila tidak)
  for (const rule of eventRules) {
    const key = eventCountKey(rule);
    if (!(key in counts)) counts[key] = 0;
  }
  return counts;
}

/**
 * Hitung ulang skor satu lead. Mengembalikan skor lama/baru agar pemanggil
 * (event bus) bisa memancarkan lead.score_changed → trigger score_reached.
 */
export async function recalculateLeadScore(
  leadId: string
): Promise<{ previous: number; score: number; changed: boolean } | null> {
  const lead = await queryOne<LeadRow>(
    `SELECT l.id, l.company_id, l.source, l.org_type, l.temperature, l.status, l.city,
            l.pic_email, l.pic_title, l.pic_phone, l.score,
            a.account_type, a.industry
     FROM crm.crm_sales_leads l
     LEFT JOIN crm.crm_accounts a ON a.id = l.account_id
     WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leadId]
  );
  if (!lead) return null;
  const rules = await loadScoringRules(lead.company_id);
  const snapshot: LeadScoringSnapshot = {
    source: lead.source,
    org_type: lead.org_type,
    temperature: lead.temperature,
    status: lead.status,
    city: lead.city,
    pic_email: lead.pic_email,
    pic_title: lead.pic_title,
    account_type: lead.account_type,
    industry: lead.industry,
  };
  const counts = await gatherEventCounts(lead, rules);
  const { score, breakdown } = computeLeadScore(rules, snapshot, counts);
  const previous = Number(lead.score) || 0;
  await query(
    `UPDATE crm.crm_sales_leads
     SET score = $2, score_breakdown = $3::jsonb, score_updated_at = now()
     WHERE id = $1`,
    [leadId, score, JSON.stringify(breakdown)]
  );
  return { previous, score, changed: previous !== score };
}

/** Hitung ulang semua lead aktif (per company bila diberikan). Dipakai tombol di Pengaturan. */
export async function recalculateAllLeadScores(companyId: string | null): Promise<{ total: number; changed: number }> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM crm.crm_sales_leads
     WHERE deleted_at IS NULL ${companyId ? "AND company_id = $1" : ""}
     ORDER BY created_at DESC LIMIT 5000`,
    companyId ? [companyId] : []
  );
  let changed = 0;
  for (const row of rows) {
    const result = await recalculateLeadScore(row.id);
    if (result?.changed) changed += 1;
  }
  return { total: rows.length, changed };
}
