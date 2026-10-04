import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import type { SalesFunnelUser } from "./server";
import { createWhere } from "./sql";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PERIOD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Periode laporan dari query string: default 90 hari terakhir; rentang
 * terbalik ditukar (laporan kosong palsu lebih menyesatkan).
 */
export function resolveReportPeriod(
  fromParam: string | null,
  toParam: string | null,
  now = new Date()
): { from: string; to: string } {
  let from = fromParam && DATE_RE.test(fromParam)
    ? fromParam
    : new Date(now.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS).toISOString().slice(0, 10);
  let to = toParam && DATE_RE.test(toParam) ? toParam : now.toISOString().slice(0, 10);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

/** Fragmen scope deal (company/branch + sales own-or-unassigned) mulai placeholder `startIndex`. */
export function dealScopeSql(
  user: SalesFunnelUser,
  scope: UserScope | null,
  startIndex: number
): { sql: string; params: unknown[] } {
  const where = createWhere([], startIndex);
  if (scope?.companyId) where.add("d.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("d.branch_id = ?", scope.branchId);
  if (user.role === "sales") where.add("(d.owner_user_id = ? OR d.owner_user_id IS NULL)", user.id);
  return { sql: where.conditions.length ? `AND ${where.sql()}` : "", params: where.params };
}

/**
 * Laporan Funnel (EPIC-022 Fase E):
 * - funnel: deal yang PERNAH mencapai tiap tahap di antara deal yang DIBUAT dalam periode
 * - ringkasan: win rate & nilai booking (deal DITUTUP dalam periode), pipeline berjalan (snapshot)
 * - breakdown per jenis instansi / acara / sumber / penanggung jawab
 * - kalender acara ter-booking ke depan + rekap alasan kalah
 */
export async function loadFunnelReport(
  user: SalesFunnelUser,
  scope: UserScope | null,
  period: { from: string; to: string }
) {
  // Query berperiode: $1=from, $2=to, scope mulai $3
  const periodScope = dealScopeSql(user, scope, 3);
  const periodParams = [period.from, period.to, ...periodScope.params];
  const createdInPeriod = `
    d.deleted_at IS NULL
    AND d.created_at >= $1::date AND d.created_at < ($2::date + 1)
    ${periodScope.sql}`;
  const closedInPeriod = `
    d.deleted_at IS NULL
    AND d.closed_at >= $1::date AND d.closed_at < ($2::date + 1)
    ${periodScope.sql}`;
  // Query snapshot (tanpa periode): scope mulai $1
  const nowScope = dealScopeSql(user, scope, 1);

  // Breakdown deal dibuat dalam periode per satu dimensi
  const breakdown = (key: string, join: "lead" | "owner" | null, tail = "ORDER BY total DESC") =>
    query(
      `SELECT ${key} AS key, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE s.is_won) AS won,
              SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
       FROM crm.crm_sales_deals d
       ${join === "lead" ? "JOIN crm.crm_sales_leads l ON l.id = d.lead_id" : ""}
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       ${join === "owner" ? "LEFT JOIN configuration.users u ON u.id = d.owner_user_id" : ""}
       WHERE ${createdInPeriod}
       GROUP BY ${key} ${tail}`,
      periodParams
    );

  const [funnel, closedSummary, totalCreated, pipelineNow, byOrgType, byEventType, bySource, byOwner, upcomingEvents, lostReasons] =
    await Promise.all([
      query(
        `SELECT s.id, s.name, s.code, s.sort_order, s.is_won,
                COUNT(DISTINCT h.deal_id) AS reached
         FROM crm.crm_sales_stages s
         LEFT JOIN crm.crm_sales_deal_stage_history h ON h.stage_id = s.id
           AND h.deal_id IN (
             SELECT d.id FROM crm.crm_sales_deals d WHERE ${createdInPeriod}
           )
         WHERE s.is_active = true AND s.is_lost = false
         GROUP BY s.id, s.name, s.code, s.sort_order, s.is_won
         ORDER BY s.sort_order ASC`,
        periodParams
      ),
      queryOne<{ won: string; lost: string; won_value: string | null }>(
        `SELECT COUNT(*) FILTER (WHERE s.is_won) AS won,
                COUNT(*) FILTER (WHERE s.is_lost) AS lost,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE ${closedInPeriod}`,
        periodParams
      ),
      queryOne<{ total: string }>(
        `SELECT COUNT(*) AS total FROM crm.crm_sales_deals d
         WHERE ${createdInPeriod}`,
        periodParams
      ),
      queryOne<{ open_count: string; pipeline_value: string | null }>(
        `SELECT COUNT(*) AS open_count,
                SUM(COALESCE(d.value_final, d.value_estimate)) AS pipeline_value
         FROM crm.crm_sales_deals d
         WHERE d.deleted_at IS NULL AND d.closed_at IS NULL ${nowScope.sql}`,
        nowScope.params
      ),
      breakdown("l.org_type", "lead"),
      breakdown("d.event_type", null),
      breakdown("l.source", "lead"),
      breakdown("COALESCE(u.full_name, 'Tanpa PJ')", "owner", "ORDER BY won DESC, total DESC LIMIT 15"),
      query(
        `SELECT d.id, d.title, d.event_type, d.event_date, d.pax_estimate,
                d.value_final, l.org_name, l.pic_name, l.pic_phone
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE d.deleted_at IS NULL AND s.is_won = true
           AND d.event_date >= CURRENT_DATE ${nowScope.sql}
         ORDER BY d.event_date ASC
         LIMIT 20`,
        nowScope.params
      ),
      query(
        `SELECT COALESCE(lr.name, 'Tanpa alasan') AS key, COUNT(*) AS total
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
         WHERE s.is_lost = true AND ${closedInPeriod}
         GROUP BY COALESCE(lr.name, 'Tanpa alasan')
         ORDER BY total DESC`,
        periodParams
      ),
    ]);

  return {
    period,
    funnel,
    summary: {
      total_created: Number(totalCreated?.total ?? 0),
      won: Number(closedSummary?.won ?? 0),
      lost: Number(closedSummary?.lost ?? 0),
      won_value: closedSummary?.won_value ?? null,
      open_count: Number(pipelineNow?.open_count ?? 0),
      pipeline_value: pipelineNow?.pipeline_value ?? null,
    },
    by_org_type: byOrgType,
    by_event_type: byEventType,
    by_source: bySource,
    by_owner: byOwner,
    upcoming_events: upcomingEvents,
    lost_reasons: lostReasons,
  };
}
