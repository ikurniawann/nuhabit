import "server-only";
/**
 * EPIC-050 Fase 2 (T-2.4) — approval diskon quotation, sisi server.
 * Alur: quotation dibuat/diubah dengan diskon > ambang → request + steps
 * berjenjang → approver diberi tahu (in-app + WA) → keputusan per tingkat →
 * quotation.approval_status = approved/rejected. Kirim WA / tandai terkirim
 * ditolak selama pending/rejected (canReleaseQuotation).
 */
import type { ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/sales-funnel/server";
import { emitCrmEvent } from "./events";
import { canDecideStep, requiredApprovalLevels, type ApprovalRule } from "./approvals";
import { notifyUsers } from "./workflow-engine";

export async function loadApprovalRules(companyId: string | null): Promise<ApprovalRule[]> {
  return query<ApprovalRule>(
    `SELECT id, level, min_discount_percent, approver_role, approver_user_id
     FROM crm.crm_approval_rules
     WHERE is_active AND object = 'quotation' AND (company_id IS NULL OR company_id = $1)
     ORDER BY level, min_discount_percent`,
    [companyId]
  );
}

type QuotationRow = {
  id: string;
  company_id: string;
  branch_id: string;
  deal_id: string;
  quote_number: string;
  total: string;
  discount_percent: string;
  approval_status: string;
  approval_request_id: string | null;
  deal_title: string;
  org_name: string;
};

async function approverUserIds(step: { approver_role: string | null; approver_user_id: string | null }, companyId: string): Promise<string[]> {
  if (step.approver_user_id) return [step.approver_user_id];
  if (!step.approver_role) return [];
  const rows = await query<{ id: string }>(
    `SELECT id FROM configuration.users
     WHERE role = $1 AND status = 'active' AND (company_id IS NULL OR company_id = $2)
     LIMIT 50`,
    [step.approver_role, companyId]
  );
  return rows.map((r) => r.id);
}

async function notifyApprovers(requestId: string, level: number): Promise<void> {
  const req = await queryOne<{
    company_id: string; subject_id: string; discount_percent: string; amount: string | null;
    quote_number: string; deal_title: string; org_name: string; deal_id: string; requester: string | null;
  }>(
    `SELECT r.company_id, r.subject_id, r.discount_percent, r.amount,
            q.quote_number, d.title AS deal_title, l.org_name, d.id AS deal_id, u.full_name AS requester
     FROM crm.crm_approval_requests r
     JOIN crm.crm_sales_quotations q ON q.id = r.subject_id
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.users u ON u.id = r.requested_by
     WHERE r.id = $1`,
    [requestId]
  );
  const step = await queryOne<{ approver_role: string | null; approver_user_id: string | null }>(
    `SELECT approver_role, approver_user_id FROM crm.crm_approval_steps WHERE request_id = $1 AND level = $2`,
    [requestId, level]
  );
  if (!req || !step) return;
  const userIds = await approverUserIds(step, req.company_id);
  const title = `Approval diskon ${Number(req.discount_percent)}% — ${req.quote_number}`;
  const message = `${req.org_name} · ${req.deal_title} · total ${formatRupiah(req.amount)}${req.requester ? ` · diajukan ${req.requester}` : ""}`;
  await notifyUsers(userIds, title, message, `/dashboard/sales-funnel/approvals?request=${requestId}`, { request_id: requestId, level });

  // WA ke approver (best-effort)
  const config = await loadGatewayConfig();
  if (!config) return;
  for (const uid of userIds) {
    const phoneRow = await queryOne<{ phone: string | null }>(
      `SELECT e.phone FROM hris.employees e WHERE e.user_id = $1 AND e.phone IS NOT NULL ORDER BY e.created_at DESC LIMIT 1`,
      [uid]
    );
    const phone = phoneRow?.phone ? normalizePhone(phoneRow.phone) : "";
    if (!isValidNormalizedPhone(phone)) continue;
    await sendGatewayText(config, {
      target: phone,
      message: `🔔 *Approval Diskon Quotation*\n\n${req.quote_number} — ${req.org_name}\nDeal: ${req.deal_title}\nDiskon: *${Number(req.discount_percent)}%* (tingkat ${level})\n${message}\n\nBuka CRM → Sales → Approval untuk menyetujui/menolak.`,
    }).catch((e) => console.error("[crm-approval] WA approver gagal:", e));
  }
}

/**
 * Sinkronkan kebutuhan approval sebuah quotation dengan diskonnya. Dipanggil
 * setelah create/update quotation. Membuat request baru bila diskon > ambang
 * (dan belum ada request pending untuk diskon yang sama), membatalkan request
 * pending lama bila diskon berubah, dan menandai `none` bila tidak perlu.
 */
export async function syncQuotationApproval(quotationId: string, requestedBy: string | null): Promise<{ approval_status: string; request_id: string | null }> {
  const q = await queryOne<QuotationRow>(
    `SELECT q.id, q.company_id, q.branch_id, q.deal_id, q.quote_number, q.total, q.discount_percent,
            q.approval_status, q.approval_request_id, d.title AS deal_title, l.org_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE q.id = $1 AND q.deleted_at IS NULL`,
    [quotationId]
  );
  if (!q) return { approval_status: "none", request_id: null };
  const discount = Number(q.discount_percent) || 0;
  const rules = await loadApprovalRules(q.company_id);
  const levels = requiredApprovalLevels(discount, rules);

  const existing = q.approval_request_id
    ? await queryOne<{ id: string; status: string; discount_percent: string }>(
        `SELECT id, status, discount_percent FROM crm.crm_approval_requests WHERE id = $1`,
        [q.approval_request_id]
      )
    : null;

  if (levels.length === 0) {
    if (existing && existing.status === "pending") {
      await query(`UPDATE crm.crm_approval_requests SET status = 'cancelled', resolved_at = now() WHERE id = $1`, [existing.id]);
    }
    await query(`UPDATE crm.crm_sales_quotations SET approval_status = 'none', approval_request_id = NULL WHERE id = $1`, [quotationId]);
    return { approval_status: "none", request_id: null };
  }

  // Request yang sudah ada & diskonnya sama → pertahankan (pending/approved/rejected)
  if (existing && Number(existing.discount_percent) === discount && existing.status !== "cancelled") {
    return { approval_status: q.approval_status, request_id: existing.id };
  }
  if (existing && existing.status === "pending") {
    await query(`UPDATE crm.crm_approval_requests SET status = 'cancelled', resolved_at = now() WHERE id = $1`, [existing.id]);
  }

  const request = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_approval_requests
       (company_id, branch_id, object, subject_id, requested_by, status, current_level, discount_percent, amount)
     VALUES ($1, $2, 'quotation', $3, $4, 'pending', $5, $6, $7) RETURNING id`,
    [q.company_id, q.branch_id, quotationId, requestedBy, levels[0].level, discount, q.total]
  );
  if (!request) return { approval_status: q.approval_status, request_id: null };
  for (const lvl of levels) {
    await query(
      `INSERT INTO crm.crm_approval_steps (request_id, level, approver_role, approver_user_id)
       VALUES ($1, $2, $3, $4)`,
      [request.id, lvl.level, lvl.approver_role, lvl.approver_user_id]
    );
  }
  await query(
    `UPDATE crm.crm_sales_quotations SET approval_status = 'pending', approval_request_id = $2 WHERE id = $1`,
    [quotationId, request.id]
  );
  await notifyApprovers(request.id, levels[0].level).catch((e) => console.error("[crm-approval] notifikasi gagal:", e));
  return { approval_status: "pending", request_id: request.id };
}

export type DecisionResult =
  | { ok: true; status: "pending" | "approved" | "rejected"; next_level: number | null }
  | { ok: false; error: string; code: 403 | 404 | 409 };

/** Keputusan satu tingkat oleh approver. */
export async function decideApproval(
  requestId: string,
  decision: "approve" | "reject",
  comment: string | null,
  user: { id: string; role: string }
): Promise<DecisionResult> {
  const req = await queryOne<{ id: string; status: string; current_level: number; subject_id: string; requested_by: string | null; company_id: string }>(
    `SELECT id, status, current_level, subject_id, requested_by, company_id FROM crm.crm_approval_requests WHERE id = $1`,
    [requestId]
  );
  if (!req) return { ok: false, error: "Permintaan approval tidak ditemukan", code: 404 };
  if (req.status !== "pending") return { ok: false, error: "Permintaan sudah diputuskan", code: 409 };
  const step = await queryOne<{ id: string; level: number; approver_role: string | null; approver_user_id: string | null }>(
    `SELECT id, level, approver_role, approver_user_id FROM crm.crm_approval_steps
     WHERE request_id = $1 AND level = $2 AND status = 'pending'`,
    [requestId, req.current_level]
  );
  if (!step) return { ok: false, error: "Tingkat approval tidak ditemukan", code: 409 };
  if (!canDecideStep(step, user)) return { ok: false, error: "Anda bukan approver tingkat ini", code: 403 };

  await query(
    `UPDATE crm.crm_approval_steps SET status = $2, decided_by = $3, decided_at = now(), comment = $4 WHERE id = $1`,
    [step.id, decision === "approve" ? "approved" : "rejected", user.id, comment]
  );

  const quotationLink = await queryOne<{ deal_id: string; quote_number: string }>(
    `SELECT deal_id, quote_number FROM crm.crm_sales_quotations WHERE id = $1`,
    [req.subject_id]
  );
  const link = quotationLink ? `/dashboard/sales-funnel/pipeline?deal=${quotationLink.deal_id}` : null;

  if (decision === "reject") {
    await query(`UPDATE crm.crm_approval_requests SET status = 'rejected', resolved_at = now(), resolved_by = $2 WHERE id = $1`, [requestId, user.id]);
    await query(`UPDATE crm.crm_sales_quotations SET approval_status = 'rejected' WHERE id = $1`, [req.subject_id]);
    if (req.requested_by) {
      await notifyUsers([req.requested_by], `Diskon ${quotationLink?.quote_number ?? ""} DITOLAK`, comment ?? "Ditolak oleh approver", link, { request_id: requestId });
    }
    return { ok: true, status: "rejected", next_level: null };
  }

  const next = await queryOne<{ level: number }>(
    `SELECT level FROM crm.crm_approval_steps WHERE request_id = $1 AND status = 'pending' ORDER BY level LIMIT 1`,
    [requestId]
  );
  if (next) {
    await query(`UPDATE crm.crm_approval_requests SET current_level = $2 WHERE id = $1`, [requestId, next.level]);
    await notifyApprovers(requestId, next.level).catch((e) => console.error("[crm-approval] notifikasi gagal:", e));
    return { ok: true, status: "pending", next_level: next.level };
  }
  await query(`UPDATE crm.crm_approval_requests SET status = 'approved', resolved_at = now(), resolved_by = $2 WHERE id = $1`, [requestId, user.id]);
  await query(`UPDATE crm.crm_sales_quotations SET approval_status = 'approved' WHERE id = $1`, [req.subject_id]);
  if (req.requested_by) {
    await notifyUsers([req.requested_by], `Diskon ${quotationLink?.quote_number ?? ""} DISETUJUI`, comment ?? "Quotation boleh dikirim", link, { request_id: requestId });
  }
  return { ok: true, status: "approved", next_level: null };
}

/**
 * Inbox approval quotation. view=mine: yang menunggu keputusan saya (role/user
 * cocok pada tingkat berjalan) + yang saya ajukan; view=all: semua di scope.
 * status=pending|approved|rejected|all.
 */
export function listApprovalInbox(
  user: Pick<ApiUser, "id" | "role">,
  scope: UserScope | null,
  filter: { view: "mine" | "all"; status: string }
) {
  const conditions: string[] = ["r.object = 'quotation'"];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(fragment.replace("?", `$${params.length}`));
  };
  if (scope?.companyId) add("r.company_id = ?", scope.companyId);
  if (filter.status !== "all") add("r.status = ?", filter.status);
  if (filter.view === "mine") {
    params.push(user.id, user.role);
    conditions.push(
      `(r.requested_by = $${params.length - 1}
        OR EXISTS (SELECT 1 FROM crm.crm_approval_steps s
                    WHERE s.request_id = r.id AND s.level = r.current_level AND s.status = 'pending'
                      AND (s.approver_user_id = $${params.length - 1}
                           OR s.approver_role = $${params.length}
                           OR $${params.length} = 'super_admin')))`
    );
  }
  return query(
    `SELECT r.id, r.status, r.current_level, r.discount_percent, r.amount, r.note, r.created_at, r.resolved_at,
            r.subject_id AS quotation_id, q.quote_number, q.total, q.subtotal, q.discount_nominal, q.status AS quotation_status,
            d.id AS deal_id, d.title AS deal_title, l.org_name, l.pic_name,
            u.full_name AS requested_by_name,
            (SELECT json_agg(json_build_object('level', s.level, 'status', s.status, 'approver_role', s.approver_role,
                                               'approver_user_id', s.approver_user_id, 'decided_at', s.decided_at,
                                               'comment', s.comment, 'decided_by_name', du.full_name) ORDER BY s.level)
               FROM crm.crm_approval_steps s LEFT JOIN configuration.users du ON du.id = s.decided_by
              WHERE s.request_id = r.id) AS steps,
            EXISTS (SELECT 1 FROM crm.crm_approval_steps s
                     WHERE s.request_id = r.id AND s.level = r.current_level AND s.status = 'pending'
                       AND (s.approver_user_id = $${params.length + 1} OR s.approver_role = $${params.length + 2} OR $${params.length + 2} = 'super_admin')) AS can_decide
     FROM crm.crm_approval_requests r
     JOIN crm.crm_sales_quotations q ON q.id = r.subject_id
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.users u ON u.id = r.requested_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC
     LIMIT 200`,
    [...params, user.id, user.role]
  );
}

/** Event CRM quotation.status_changed setelah keputusan approval (memicu workflow). */
export async function emitApprovalDecisionEvent(
  requestId: string,
  actorUserId: string,
  payload: { approval: string; decision: string }
) {
  const req = await queryOne<{ subject_id: string; company_id: string; branch_id: string | null }>(
    `SELECT subject_id, company_id, branch_id FROM crm.crm_approval_requests WHERE id = $1`,
    [requestId]
  );
  if (!req) return;
  await emitCrmEvent({
    event_type: "quotation.status_changed",
    subject_type: "quotation",
    subject_id: req.subject_id,
    company_id: req.company_id,
    branch_id: req.branch_id,
    actor_user_id: actorUserId,
    payload,
  });
}
