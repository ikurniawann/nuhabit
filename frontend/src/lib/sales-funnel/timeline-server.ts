import { query, queryOne } from "@/lib/db";
import type { TaskSubjectType } from "./tasks";
import { mergeTimeline, type TimelineEvent, type TimelineSources } from "./timeline";

/**
 * Himpunan lead/deal/task yang tercakup satu subjek ($1 = subject_id):
 *   lead    → lead + deal-dealnya
 *   deal    → deal itu saja
 *   account → semua lead/deal/contact di bawahnya
 *   contact → lead yang menautkan contact
 *   member  → task member saja
 */
export function timelineScopeSql(type: TaskSubjectType): { leadWhere: string; dealWhere: string; taskExtra: string } {
  switch (type) {
    case "lead":
      return {
        leadWhere: "l.id = $1",
        dealWhere: "d.lead_id = $1",
        taskExtra: "(a.lead_id = $1 OR (a.subject_type = 'lead' AND a.subject_id = $1))",
      };
    case "deal":
      return { leadWhere: "FALSE", dealWhere: "d.id = $1", taskExtra: "a.deal_id = $1" };
    case "account":
      return {
        leadWhere: "l.account_id = $1",
        dealWhere: "d.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL)",
        taskExtra: `((a.subject_type = 'account' AND a.subject_id = $1)
          OR (a.subject_type = 'contact' AND a.subject_id IN (SELECT id FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL)))`,
      };
    case "contact":
      return {
        leadWhere: "l.contact_id = $1",
        dealWhere: "d.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE contact_id = $1 AND deleted_at IS NULL)",
        taskExtra: "(a.subject_type = 'contact' AND a.subject_id = $1)",
      };
    case "member":
      return { leadWhere: "FALSE", dealWhere: "FALSE", taskExtra: "(a.subject_type = 'member' AND a.subject_id = $1)" };
  }
}

/** Nomor di wa_messages bisa tersimpan 08…/62…; cocokkan pada 9 digit terakhir. */
export function phoneSuffixes(phones: string[]): string[] {
  return phones.map((p) => p.replace(/[^0-9]/g, "").slice(-9)).filter((s) => s.length >= 9);
}

async function loadSubjectPhones(type: TaskSubjectType, subjectId: string): Promise<string[]> {
  const single = async (sql: string) => {
    const row = await queryOne<{ phone: string | null }>(sql, [subjectId]);
    return row?.phone ? [row.phone] : [];
  };
  switch (type) {
    case "lead":
      return single(`SELECT pic_phone AS phone FROM crm.crm_sales_leads WHERE id = $1`);
    case "deal":
      return single(
        `SELECT l.pic_phone AS phone FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id WHERE d.id = $1`
      );
    case "contact":
      return single(`SELECT phone FROM crm.crm_contacts WHERE id = $1`);
    case "member":
      return single(`SELECT phone FROM pos.pos_customers WHERE id = $1`);
    case "account": {
      const rows = await query<{ phone: string }>(
        `SELECT phone FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL LIMIT 20`,
        [subjectId]
      );
      return rows.map((r) => r.phone);
    }
  }
}

/**
 * EPIC-050 Fase 1 (T-1.4) — gabungan task/aktivitas, riwayat tahap deal,
 * quotation, invoice, dan pesan WA (lewat nomor telepon subjek) satu record.
 */
export async function loadTimeline(type: TaskSubjectType, subjectId: string, limit: number): Promise<TimelineEvent[]> {
  const { leadWhere, dealWhere, taskExtra } = timelineScopeSql(type);
  const params = [subjectId];
  const dealIdsSql = `SELECT d.id FROM crm.crm_sales_deals d WHERE d.deleted_at IS NULL AND ${dealWhere}`;

  const sources: TimelineSources = {};
  sources.tasks = await query(
    `SELECT a.id, a.activity_type, a.title, a.notes, a.due_at, a.done_at, a.status,
            a.priority, a.created_at, u.full_name AS owner_name, d.title AS deal_title
     FROM crm.crm_sales_activities a
     LEFT JOIN configuration.users u ON u.id = a.owner_user_id
     LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
     WHERE a.deleted_at IS NULL
       AND (${taskExtra}
            OR a.deal_id IN (${dealIdsSql})
            OR a.lead_id IN (SELECT l.id FROM crm.crm_sales_leads l WHERE l.deleted_at IS NULL AND ${leadWhere}))
     ORDER BY COALESCE(a.done_at, a.due_at, a.created_at) DESC
     LIMIT 200`,
    params
  );
  if (type !== "member") {
    sources.stages = await query(
      `SELECT h.id, h.deal_id, d.title AS deal_title, s.name AS stage_name, h.entered_at,
              u.full_name AS actor_name
       FROM crm.crm_sales_deal_stage_history h
       JOIN crm.crm_sales_deals d ON d.id = h.deal_id
       JOIN crm.crm_sales_stages s ON s.id = h.stage_id
       LEFT JOIN configuration.users u ON u.id = h.created_by
       WHERE h.deal_id IN (${dealIdsSql})
       ORDER BY h.entered_at DESC LIMIT 100`,
      params
    );
    sources.quotations = await query(
      `SELECT q.id, q.deal_id, q.quote_number, q.status, q.total, q.created_at
       FROM crm.crm_sales_quotations q
       WHERE q.deleted_at IS NULL AND q.deal_id IN (${dealIdsSql})
       ORDER BY q.created_at DESC LIMIT 50`,
      params
    );
    sources.invoices = await query(
      `SELECT i.id, i.deal_id, i.invoice_number, i.label, i.status, i.amount, i.created_at
       FROM crm.crm_sales_invoices i
       WHERE i.deleted_at IS NULL AND i.deal_id IN (${dealIdsSql})
       ORDER BY i.created_at DESC LIMIT 50`,
      params
    );
    if (type === "account" || type === "contact") {
      sources.leads = await query(
        `SELECT l.id, l.org_name, l.status, l.created_at, u.full_name AS owner_name
         FROM crm.crm_sales_leads l LEFT JOIN configuration.users u ON u.id = l.owner_user_id
         WHERE l.deleted_at IS NULL AND ${leadWhere}
         ORDER BY l.created_at DESC LIMIT 50`,
        params
      );
    }
    if (type !== "deal") {
      sources.deals = await query(
        `SELECT d.id, d.title, s.name AS stage_name, d.created_at, u.full_name AS owner_name
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN configuration.users u ON u.id = d.owner_user_id
         WHERE d.deleted_at IS NULL AND ${dealWhere}
         ORDER BY d.created_at DESC LIMIT 50`,
        params
      );
    }
  }

  const suffixes = phoneSuffixes(await loadSubjectPhones(type, subjectId));
  if (suffixes.length > 0) {
    sources.waMessages = await query(
      `SELECT m.id, m.direction, m.body, m.status, m.created_at, u.full_name AS sender_name
       FROM crm.wa_messages m
       LEFT JOIN configuration.users u ON u.id = m.sent_by_user_id
       WHERE right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 9) = ANY($1::text[])
       ORDER BY m.created_at DESC LIMIT 100`,
      [suffixes]
    );
  }

  return mergeTimeline(sources, limit);
}
