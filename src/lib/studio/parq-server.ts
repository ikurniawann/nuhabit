import { ApiError } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import type { BookingActor } from "@/lib/studio/booking-server";
import { FLAG_NOTE_MAX } from "@/lib/studio/member-flags";
import { type ParqAnswers, parqAnswersComplete, parqDue, PARQ_QUESTIONS, PARQ_VERSION, planParqFlags } from "@/lib/studio/parq";

/**
 * PAR-Q di Member App (EPIC-067 T-067-C3). Setiap isian disimpan; jawaban
 * "ya" menyinkronkan penanda medis source 'parq' (perlu ditinjau coach):
 *  - jenis yang dijawab "ya" → dibuat, atau catatannya diperbarui (dan
 *    kembali "perlu ditinjau" bila isinya berubah);
 *  - jenis yang kini "tidak" → penanda PAR-Q yang BELUM ditinjau dihapus;
 *    yang sudah dikonfirmasi coach dibiarkan (keputusan coach dihormati).
 * Member tidak pernah melihat penanda — hanya status isiannya.
 */

export interface ParqStatus {
  version: string;
  due: boolean;
  last: { submitted_at: string; has_yes: boolean; answers: ParqAnswers; details: string | null } | null;
  questions: { code: string; text: string }[];
}

export async function memberParqStatus(customerId: string, now = new Date()): Promise<ParqStatus> {
  const last = await queryOne<{ submitted_at: string; version: string; has_yes: boolean; answers: ParqAnswers; details: string | null }>(
    `SELECT submitted_at, version, has_yes, answers, details FROM studio.health_declarations
     WHERE customer_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
    [customerId]
  );
  return {
    version: PARQ_VERSION,
    due: parqDue(last, now),
    last: last ? { submitted_at: last.submitted_at, has_yes: last.has_yes, answers: last.answers, details: last.details } : null,
    questions: PARQ_QUESTIONS.map(({ code, text }) => ({ code, text })),
  };
}

export async function submitParq(
  actor: BookingActor,
  customerId: string,
  input: { answers: Record<string, unknown>; details?: string | null }
): Promise<{ id: string; has_yes: boolean; flags: number }> {
  if (!parqAnswersComplete(input.answers)) throw ApiError.badRequest("Please answer every question.");
  const answers: ParqAnswers = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.code, input.answers[q.code] as boolean]));
  const details = input.details?.trim() || null;
  const plan = planParqFlags(answers, details, FLAG_NOTE_MAX);
  const hasYes = plan.length > 0;

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO studio.health_declarations (company_id, branch_id, customer_id, version, answers, has_yes, details)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [actor.companyId, actor.branchId, customerId, PARQ_VERSION, JSON.stringify(answers), hasYes, details]
    );
    const declarationId = rows[0].id;
    const { rows: types } = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM studio.member_flag_types WHERE code IN ('medical_condition','injury','pregnant')`
    );
    const typeId = (code: string) => types.find((t) => t.code === code)?.id;
    const { rows: existing } = await client.query<{ id: string; type_id: string; note: string | null; needs_review: boolean }>(
      `SELECT id, type_id, note, needs_review FROM studio.member_flags
       WHERE customer_id = $1 AND branch_id = $2 AND source = 'parq' AND removed_at IS NULL
       FOR UPDATE`,
      [customerId, actor.branchId]
    );
    for (const p of plan) {
      const tid = typeId(p.type);
      if (!tid) continue;
      const cur = existing.find((e) => e.type_id === tid);
      if (!cur) {
        await client.query(
          `INSERT INTO studio.member_flags (company_id, branch_id, customer_id, type_id, severity, note, source, needs_review, declaration_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'parq', true, $7)`,
          [actor.companyId, actor.branchId, customerId, tid, p.severity, p.note, declarationId]
        );
      } else if (cur.note !== p.note) {
        // Isi berubah → coach perlu meninjau ulang.
        await client.query(
          `UPDATE studio.member_flags SET note = $2, severity = $3, needs_review = true, reviewed_at = NULL, reviewed_by_coach_id = NULL,
             declaration_id = $4, updated_at = now() WHERE id = $1`,
          [cur.id, p.note, p.severity, declarationId]
        );
      } else {
        await client.query(`UPDATE studio.member_flags SET declaration_id = $2, updated_at = now() WHERE id = $1`, [cur.id, declarationId]);
      }
    }
    const keep = new Set(plan.map((p) => typeId(p.type)));
    for (const e of existing) {
      if (!keep.has(e.type_id) && e.needs_review) {
        await client.query(`UPDATE studio.member_flags SET removed_at = now(), updated_at = now() WHERE id = $1`, [e.id]);
      }
    }
    return { id: declarationId, has_yes: hasYes, flags: plan.length };
  });
}

