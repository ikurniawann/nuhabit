/**
 * EPIC-050 Fase 2 (T-2.1) — event bus internal CRM.
 *
 * `emitCrmEvent()` dipanggil dari server action/route yang sudah ada (lead,
 * deal, task, quotation). Best-effort: mencatat ke crm_events, menghitung
 * ulang skor lead yang terdampak, lalu menjalankan workflow rules. Tidak
 * pernah melempar error ke pemanggil — kegagalan hanya dicatat di log.
 */
import { query, queryOne } from "@/lib/db";
import { recalculateLeadScore } from "./scoring-server";
import { processWorkflowEvent, type CrmEventInput } from "./workflow-engine";

export type { CrmEventInput };

/** Lead yang terdampak event (untuk hitung ulang skor). */
async function affectedLeadId(event: CrmEventInput): Promise<string | null> {
  switch (event.subject_type) {
    case "lead":
      return event.subject_id;
    case "deal": {
      const row = await queryOne<{ lead_id: string }>(`SELECT lead_id FROM crm.crm_sales_deals WHERE id = $1`, [event.subject_id]);
      return row?.lead_id ?? null;
    }
    case "task": {
      const row = await queryOne<{ lead_id: string | null; deal_id: string | null; subject_type: string | null; subject_id: string | null }>(
        `SELECT lead_id, deal_id, subject_type, subject_id FROM crm.crm_sales_activities WHERE id = $1`,
        [event.subject_id]
      );
      if (!row) return null;
      if (row.lead_id) return row.lead_id;
      if (row.subject_type === "lead" && row.subject_id) return row.subject_id;
      if (row.deal_id) {
        const d = await queryOne<{ lead_id: string }>(`SELECT lead_id FROM crm.crm_sales_deals WHERE id = $1`, [row.deal_id]);
        return d?.lead_id ?? null;
      }
      return null;
    }
    case "quotation": {
      const row = await queryOne<{ lead_id: string }>(
        `SELECT d.lead_id FROM crm.crm_sales_quotations q JOIN crm.crm_sales_deals d ON d.id = q.deal_id WHERE q.id = $1`,
        [event.subject_id]
      );
      return row?.lead_id ?? null;
    }
    default:
      return null;
  }
}

export async function emitCrmEvent(event: CrmEventInput): Promise<void> {
  try {
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO crm.crm_events (company_id, branch_id, event_type, subject_type, subject_id, payload, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [
        event.company_id,
        event.branch_id,
        event.event_type,
        event.subject_type,
        event.subject_id,
        JSON.stringify(event.payload ?? {}),
        event.actor_user_id ?? null,
      ]
    );
    const eventId = inserted?.id ?? null;

    // 1) workflow untuk event ini
    await processWorkflowEvent({ ...event, id: eventId });

    // 2) skor lead terdampak (+ event turunan score_changed bila berubah)
    const leadId = await affectedLeadId(event);
    if (leadId) {
      const result = await recalculateLeadScore(leadId);
      if (result?.changed) {
        const lead = await queryOne<{ company_id: string; branch_id: string }>(
          `SELECT company_id, branch_id FROM crm.crm_sales_leads WHERE id = $1`,
          [leadId]
        );
        const scoreEvent: CrmEventInput = {
          event_type: "lead.score_changed",
          subject_type: "lead",
          subject_id: leadId,
          company_id: lead?.company_id ?? event.company_id,
          branch_id: lead?.branch_id ?? event.branch_id,
          payload: { previous_score: result.previous, score: result.score, source_event: event.event_type },
          actor_user_id: event.actor_user_id ?? null,
        };
        const scoreInserted = await queryOne<{ id: string }>(
          `INSERT INTO crm.crm_events (company_id, branch_id, event_type, subject_type, subject_id, payload, actor_user_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
          [scoreEvent.company_id, scoreEvent.branch_id, scoreEvent.event_type, "lead", leadId, JSON.stringify(scoreEvent.payload), scoreEvent.actor_user_id]
        );
        await processWorkflowEvent({ ...scoreEvent, id: scoreInserted?.id ?? null });
      }
    }
  } catch (err) {
    console.error(`[crm-events] ${event.event_type} gagal diproses:`, err);
  }
}

/** Riwayat event satu subjek (untuk debug/timeline lanjutan). */
export async function listSubjectEvents(subjectType: string, subjectId: string, limit = 50) {
  return query(
    `SELECT id, event_type, payload, actor_user_id, created_at FROM crm.crm_events
     WHERE subject_type = $1 AND subject_id = $2 ORDER BY created_at DESC LIMIT $3`,
    [subjectType, subjectId, limit]
  );
}
